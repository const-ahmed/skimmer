import { REPOSITORY_LIMITS } from '@/server/analysis/limits'
import { dirname, joinPath } from './paths'
import type { RepositorySnapshot } from './types'

export interface PathMapping {
  /** At most one `*`. */
  pattern: string
  /** Repository-relative targets, at most one `*` each. */
  targets: string[]
}

export interface TsPathConfig {
  directory: string
  baseUrl: string | null
  mappings: PathMapping[]
}

const CONFIG_FILE = /(?:^|\/)[tj]sconfig\.json$/
const JS_SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i

// Ranked by how many JS/TS files each config governs (the nearest config governs a file, as in TypeScript).
export function findConfigPaths(snapshot: RepositorySnapshot): string[] {
  const configByDirectory = new Map<string, string>()
  for (const entry of snapshot.entries.values()) {
    if (entry.type !== 'blob' || !CONFIG_FILE.test(entry.path)) continue
    const directory = dirname(entry.path)
    const existing = configByDirectory.get(directory)
    if (!existing || (entry.path.endsWith('tsconfig.json') && !existing.endsWith('tsconfig.json')))
      configByDirectory.set(directory, entry.path)
  }
  const governed = new Map<string, number>()
  for (const entry of snapshot.entries.values()) {
    if (entry.type !== 'blob' || !JS_SOURCE.test(entry.path)) continue
    for (let directory = dirname(entry.path); ; directory = dirname(directory)) {
      const config = configByDirectory.get(directory)
      if (config) {
        governed.set(config, (governed.get(config) ?? 0) + 1)
        break
      }
      if (!directory) break
    }
  }
  return [...configByDirectory.values()]
    .sort(
      (a, b) =>
        (governed.get(b) ?? 0) - (governed.get(a) ?? 0) ||
        a.split('/').length - b.split('/').length ||
        a.localeCompare(b),
    )
    .slice(0, REPOSITORY_LIMITS.maxTsconfigFiles)
}

// Package `extends` (e.g. "@tsconfig/node20") are ignored: they live outside the analysed commit.
export async function loadTsPathConfigs(
  snapshot: RepositorySnapshot,
  read: (paths: string[]) => Promise<void>,
  getText: (path: string) => string | undefined,
): Promise<TsPathConfig[]> {
  const roots = findConfigPaths(snapshot)
  let frontier = roots
  const requested = new Set<string>()
  for (let depth = 0; depth <= REPOSITORY_LIMITS.maxTsconfigExtendsDepth && frontier.length; depth++) {
    const toRead = frontier.filter((path) => !requested.has(path))
    toRead.forEach((path) => requested.add(path))
    await read(toRead)
    frontier = toRead.flatMap((path) => {
      const parsed = parseJsonc(getText(path) ?? '')
      return extendsTargets(path, parsed).filter((target) =>
        snapshot.entries.has(target),
      )
    })
  }
  return roots.flatMap((path) => {
    const config = resolveConfig(path, getText, 0)
    return config && (config.mappings.length || config.baseUrl) ? [config] : []
  })
}

function extendsTargets(configPath: string, parsed: unknown): string[] {
  const value = isRecord(parsed) ? parsed.extends : undefined
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  return list.flatMap((entry) => {
    if (typeof entry !== 'string' || !entry.startsWith('.')) return []
    const joined = joinPath(dirname(configPath), entry)
    if (!joined) return []
    return [joined.endsWith('.json') ? joined : `${joined}.json`]
  })
}

function resolveConfig(
  configPath: string,
  getText: (path: string) => string | undefined,
  depth: number,
): TsPathConfig | null {
  const text = getText(configPath)
  if (text === undefined) return null
  const parsed = parseJsonc(text)
  if (!isRecord(parsed)) return null
  const directory = dirname(configPath)

  let inherited: TsPathConfig | null = null
  if (depth < REPOSITORY_LIMITS.maxTsconfigExtendsDepth)
    for (const target of extendsTargets(configPath, parsed))
      inherited = resolveConfig(target, getText, depth + 1) ?? inherited

  const options = isRecord(parsed.compilerOptions) ? parsed.compilerOptions : {}
  const baseUrl =
    typeof options.baseUrl === 'string'
      ? joinPath(directory, options.baseUrl)
      : (inherited?.baseUrl ?? null)

  let mappings = inherited?.mappings ?? []
  if (isRecord(options.paths)) {
    // Without baseUrl, paths resolve against the config that declares them.
    const root = typeof options.baseUrl === 'string' ? baseUrl : directory
    mappings = Object.entries(options.paths).flatMap(([pattern, targets]) => {
      if (!Array.isArray(targets) || countStars(pattern) > 1) return []
      const resolved = targets.flatMap((target) => {
        if (typeof target !== 'string' || countStars(target) > 1) return []
        const joined = joinPath(root ?? '', target)
        return joined === null ? [] : [joined]
      })
      return resolved.length ? [{ pattern, targets: resolved }] : []
    })
  }
  return { directory, baseUrl, mappings }
}

export function applyPathMappings(
  specifier: string,
  mappings: readonly PathMapping[],
): string[] {
  let best: { mapping: PathMapping; captured: string; prefix: number } | null = null
  for (const mapping of mappings) {
    const star = mapping.pattern.indexOf('*')
    if (star === -1) {
      if (mapping.pattern === specifier)
        return mapping.targets.map((target) => target.replace('*', ''))
      continue
    }
    const prefix = mapping.pattern.slice(0, star)
    const suffix = mapping.pattern.slice(star + 1)
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      (!best || prefix.length > best.prefix)
    )
      best = {
        mapping,
        captured: specifier.slice(prefix.length, specifier.length - suffix.length),
        prefix: prefix.length,
      }
  }
  if (!best) return []
  return best.mapping.targets.map((target) => target.replace('*', best.captured))
}

function countStars(value: string): number {
  return value.split('*').length - 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JSON with comments and trailing commas, as tsconfig allows. */
export function parseJsonc(text: string): unknown {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    if (char === '"') {
      const start = index++
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index++
        index++
      }
      out += text.slice(start, ++index)
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index++
    }
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return null
  }
}
