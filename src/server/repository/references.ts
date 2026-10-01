// A reference means two files are statically related. It is not a call and
// says nothing about runtime order.

import { REPOSITORY_LIMITS } from '@/server/analysis/limits'
import { createLineLocator } from './lines'
import { dirname, joinPath } from './paths'
import { applyPathMappings, type TsPathConfig } from './tsconfig-paths'
import type { StaticReference, TreeEntry } from './types'

export type ReferenceResolver = (path: string, text: string) => StaticReference[]

const JS_SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i
const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro']
// In these languages a file is named after its type, so the type name alone links to the file.
const TYPE_FAMILIES: Record<string, RegExp> = {
  cs: /\.cs$/i,
  jvm: /\.(?:java|kts?|scala)$/i,
  swift: /\.swift$/i,
  php: /\.php$/i,
}
const TYPE_NAME = /^[A-Z][A-Za-z0-9]{2,}$/

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function familyOf(path: string): string | null {
  for (const [family, pattern] of Object.entries(TYPE_FAMILIES))
    if (pattern.test(path)) return family
  return null
}

// Offsets and newlines are kept so reference line numbers stay correct.
function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  )
}

export function createReferenceResolver(
  entries: ReadonlyMap<string, TreeEntry>,
  tsConfigs: readonly TsPathConfig[] = [],
): ReferenceResolver {
  const blobs = new Set<string>()
  const trees = new Set<string>()
  const byStem = new Map<string, string[]>()
  const typeFiles = new Map<string, Map<string, string | null>>()
  for (const [path, entry] of entries) {
    if (entry.type === 'tree') {
      trees.add(path)
      continue
    }
    blobs.add(path)
    const stem = stemOf(path)
    const list = byStem.get(stem)
    if (list) list.push(path)
    else byStem.set(stem, [path])
    const family = familyOf(path)
    if (family && TYPE_NAME.test(stem) && /[a-z]/.test(stem)) {
      const names = typeFiles.get(family) ?? new Map<string, string | null>()
      typeFiles.set(family, names)
      names.set(stem, names.has(stem) ? null : path)
    }
  }
  // Nearest config wins, as TypeScript picks the closest tsconfig.
  const configs = [...tsConfigs].sort(
    (a, b) => b.directory.length - a.directory.length,
  )
  const configFor = (path: string) =>
    configs.find(
      (config) => !config.directory || path.startsWith(`${config.directory}/`),
    )

  const bySuffix = (suffix: string): string | null => {
    let best: string | null = null
    for (const candidate of byStem.get(stemOf(suffix)) ?? []) {
      if (candidate !== suffix && !candidate.endsWith(`/${suffix}`)) continue
      if (!best || candidate.length < best.length) best = candidate
    }
    return best
  }

  const jsFile = (base: string): string | null => {
    if (blobs.has(base) && extensionOf(base)) return base
    const swapped = base.replace(/\.(m|c)?js(x?)$/i, (_, kind = '', x) =>
      kind ? `.${kind}ts` : `.ts${x}`,
    )
    if (swapped !== base && blobs.has(swapped)) return swapped
    for (const extension of JS_EXTENSIONS)
      if (blobs.has(`${base}${extension}`)) return `${base}${extension}`
    for (const extension of JS_EXTENSIONS)
      if (blobs.has(`${base}/index${extension}`)) return `${base}/index${extension}`
    return null
  }

  type Add = (target: string, offset: number) => void

  const resolveJs = (path: string, text: string, add: Add) => {
    const directory = dirname(path)
    const config = configFor(path)
    for (const match of text.matchAll(
      /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*\(?\s*["']([^"'\n]{1,300})["']/g,
    )) {
      const specifier = match[1]!
      const offset = match.index
      if (specifier.startsWith('.')) {
        const base = joinPath(directory, specifier)
        const file = base === null ? null : jsFile(base)
        if (file) add(file, offset)
        continue
      }
      if (config) {
        const mapped = applyPathMappings(specifier, config.mappings)
          .map(jsFile)
          .find((file): file is string => file !== null)
        if (mapped) {
          add(mapped, offset)
          continue
        }
        if (config.baseUrl !== null) {
          const base = joinPath(config.baseUrl, specifier)
          const file = base === null ? null : jsFile(base)
          if (file) {
            add(file, offset)
            continue
          }
        }
      } else {
        // No tsconfig in scope: fall back to the common "~/" "@/" "#/" → src/ convention.
        const alias = /^[~@#]\/(.+)$/.exec(specifier)?.[1]
        if (alias) {
          const file = jsFile(`src/${alias}`) ?? jsFile(alias)
          if (file) add(file, offset)
          continue
        }
      }
      // A scoped workspace package ("@acme/ui" in packages/ui). Unscoped names
      // are skipped; "next" would wrongly match a repository's own packages/next.
      const bare = /^@[^/]+\/([^/]+)/.exec(specifier)?.[1]
      if (!bare) continue
      for (const root of ['packages', 'apps', 'libs']) {
        if (trees.has(`${root}/${bare}`)) {
          add(`${root}/${bare}`, offset)
          break
        }
      }
    }
  }

  const pythonModule = (moduleName: string): string | null => {
    const relative = moduleName.replace(/\./g, '/')
    return bySuffix(`${relative}.py`) ?? bySuffix(`${relative}/__init__.py`)
  }

  const resolvePython = (path: string, text: string, add: Add) => {
    const directory = dirname(path)
    for (const match of text.matchAll(
      /^[\t ]*from[\t ]+(\.*)([\w.]*)[\t ]+import[\t ]+(\([^)]*\)|[^\n#]+)/gm,
    )) {
      const offset = match.index
      const dots = match[1]!.length
      const moduleName = match[2]!
      const names = match[3]!
        .replace(/[()]/g, '')
        .split(',')
        .map((name) => name.trim().split(/\s+/)[0]!)
        .filter((name) => /^\w+$/.test(name))
      if (dots) {
        let base: string | null = directory
        for (let level = 1; level < dots && base !== null; level++)
          base = base ? dirname(base) : null
        if (base === null) continue
        const folder = moduleName ? joinPath(base, moduleName.replace(/\./g, '/')) : base
        if (folder === null) continue
        const file = blobs.has(`${folder}.py`)
          ? `${folder}.py`
          : blobs.has(`${folder}/__init__.py`)
            ? `${folder}/__init__.py`
            : null
        let submodule = false
        for (const name of names) {
          const child = blobs.has(`${folder}/${name}.py`)
            ? `${folder}/${name}.py`
            : blobs.has(`${folder}/${name}/__init__.py`)
              ? `${folder}/${name}/__init__.py`
              : null
          if (child) {
            add(child, offset)
            submodule = true
          }
        }
        if (file && !submodule) add(file, offset)
        continue
      }
      let submodule = false
      for (const name of names) {
        const child = pythonModule(`${moduleName}.${name}`)
        if (child) {
          add(child, offset)
          submodule = true
        }
      }
      const file = pythonModule(moduleName)
      if (file && !submodule) add(file, offset)
    }
    for (const match of text.matchAll(/^[\t ]*import[\t ]+([^\n#]+)/gm)) {
      for (const entry of match[1]!.split(',')) {
        const moduleName = entry.trim().split(/\s+/)[0]!
        if (!/^[\w.]+$/.test(moduleName)) continue
        const file = pythonModule(moduleName)
        if (file) add(file, match.index)
      }
    }
  }

  const resolveRust = (path: string, text: string, add: Add) => {
    const sourceRoot = /^(.*\/)?src\//.exec(path)
    const crateRoot = sourceRoot ? `${sourceRoot[1] ?? ''}src` : dirname(path) || ''
    const directory = dirname(path)
    const stem = stemOf(path)
    const selfDirectory = ['mod', 'lib', 'main'].includes(stem)
      ? directory
      : directory
        ? `${directory}/${stem}`
        : stem
    const moduleFile = (base: string, segments: string[]) => {
      for (let length = segments.length; length > 0; length--) {
        const prefix = [base, ...segments.slice(0, length)].filter(Boolean).join('/')
        if (blobs.has(`${prefix}.rs`)) return `${prefix}.rs`
        if (blobs.has(`${prefix}/mod.rs`)) return `${prefix}/mod.rs`
      }
      return null
    }
    const resolvePath = (anchor: string, rest: string[], offset: number) => {
      let base =
        anchor === 'crate' ? crateRoot : anchor === 'self' ? selfDirectory : dirname(selfDirectory)
      let segments = rest
      while (segments[0] === 'super') {
        base = dirname(base)
        segments = segments.slice(1)
      }
      const file = moduleFile(base, segments)
      if (file && file !== path) add(file, offset)
    }
    for (const match of text.matchAll(
      /\b(crate|super|self)((?:::[A-Za-z_]\w*)*)::\{([^{}]*)\}/g,
    )) {
      const prefix = match[2]!.split('::').filter(Boolean)
      for (const item of match[3]!.split(',')) {
        const segments = /^\s*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)/.exec(item)?.[1]?.split('::')
        if (segments && segments[0] !== 'self')
          resolvePath(match[1]!, [...prefix, ...segments], match.index)
      }
      if (prefix.length) resolvePath(match[1]!, prefix, match.index)
    }
    for (const match of text.matchAll(/\b(crate|super|self)((?:::[A-Za-z_]\w*)+)/g))
      resolvePath(match[1]!, match[2]!.split('::').filter(Boolean), match.index)
    for (const match of text.matchAll(
      /^[\t ]*(?:pub(?:\([^)]*\))?[\t ]+)?mod[\t ]+([A-Za-z_]\w*)[\t ]*;/gm,
    )) {
      const file = moduleFile(selfDirectory, [match[1]!])
      if (file) add(file, match.index)
    }
  }

  const resolveGo = (text: string, add: Add) => {
    const imports: Array<[string, number]> = []
    for (const match of text.matchAll(/^[\t ]*import[\t ]*(?:[\w.]+[\t ]+)?"([^"\n]+)"/gm))
      imports.push([match[1]!, match.index])
    for (const block of text.matchAll(/^[\t ]*import[\t ]*\(([\s\S]*?)\)/gm)) {
      const blockStart = block.index + block[0].indexOf('(') + 1
      for (const match of block[1]!.matchAll(/"([^"\n]+)"/g))
        imports.push([match[1]!, blockStart + match.index])
    }
    for (const [specifier, offset] of imports) {
      const segments = specifier.split('/')
      // Only module paths (a domain first) can name this repository's packages.
      if (!segments[0]?.includes('.')) continue
      for (let start = 1; start < segments.length; start++) {
        const folder = segments.slice(start).join('/')
        if (trees.has(folder)) {
          add(folder, offset)
          break
        }
      }
    }
  }

  const resolveJvm = (text: string, add: Add) => {
    for (const match of text.matchAll(/^[\t ]*import[\t ]+(?:static[\t ]+)?([\w.]+)/gm)) {
      const segments = match[1]!.split('.')
      for (const drop of [0, 1]) {
        const parts = segments.slice(0, segments.length - drop)
        if (parts.length < 2) continue
        const relative = parts.join('/')
        const file =
          bySuffix(`${relative}.java`) ?? bySuffix(`${relative}.kt`) ?? bySuffix(`${relative}.scala`)
        if (file) {
          add(file, match.index)
          break
        }
      }
    }
  }

  const resolveInclude = (path: string, text: string, add: Add) => {
    for (const match of text.matchAll(/^[\t ]*#[\t ]*include[\t ]*"([^"\n]+)"/gm)) {
      const relative = joinPath(dirname(path), match[1]!)
      if (relative && blobs.has(relative)) add(relative, match.index)
      else {
        const file = bySuffix(match[1]!.replace(/^(?:\.\.?\/)+/, ''))
        if (file) add(file, match.index)
      }
    }
  }

  const resolvePhp = (path: string, text: string, add: Add) => {
    for (const match of text.matchAll(/^[\t ]*use[\t ]+([\w\\]+)/gm)) {
      const segments = match[1]!.split('\\').filter(Boolean)
      if (segments.length < 2) continue
      const file = bySuffix(`${segments.slice(-2).join('/')}.php`)
      if (file) add(file, match.index)
    }
    for (const match of text.matchAll(
      /\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?["']([^"'\n]+\.php)["']/g,
    )) {
      const relative = joinPath(dirname(path), match[1]!)
      if (relative && blobs.has(relative)) add(relative, match.index)
    }
  }

  const resolveRuby = (path: string, text: string, add: Add) => {
    for (const match of text.matchAll(/\brequire_relative\s*\(?\s*["']([^"'\n]+)["']/g)) {
      const relative = joinPath(dirname(path), match[1]!)
      if (!relative) continue
      const file = relative.endsWith('.rb') ? relative : `${relative}.rb`
      if (blobs.has(file)) add(file, match.index)
    }
  }

  const resolveTypeNames = (path: string, text: string, add: Add) => {
    const family = familyOf(path)
    const names = family ? typeFiles.get(family) : undefined
    if (!names) return
    const seen = new Set<string>()
    for (const match of blankComments(text).matchAll(/\b[A-Z][A-Za-z0-9]{2,}\b/g)) {
      const name = match[0]
      if (seen.has(name)) continue
      seen.add(name)
      const file = names.get(name)
      if (file && file !== path) add(file, match.index)
    }
  }

  return (path, text) => {
    const locate = createLineLocator(text)
    const found = new Map<string, number>()
    const add: Add = (target, offset) => {
      if (target === path || found.has(target)) return
      found.set(target, locate(offset))
    }
    const extension = extensionOf(path)
    if (JS_SOURCE.test(path)) resolveJs(path, text, add)
    else if (extension === '.py') resolvePython(path, text, add)
    else if (extension === '.rs') resolveRust(path, text, add)
    else if (extension === '.go') resolveGo(text, add)
    else if (/^\.(?:c|cc|cpp|h|hpp)$/.test(extension)) resolveInclude(path, text, add)
    else if (extension === '.rb') resolveRuby(path, text, add)
    if (TYPE_FAMILIES.jvm!.test(path)) resolveJvm(text, add)
    if (extension === '.php') resolvePhp(path, text, add)
    resolveTypeNames(path, text, add)
    return [...found]
      .slice(0, REPOSITORY_LIMITS.maxReferencesPerFile)
      .map(([toPath, line]) => ({ fromPath: path, toPath, line }))
  }
}
