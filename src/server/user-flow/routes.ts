import { dirname, isGeneratedPath, isPeripheralPath, isSensitivePath, pathCovers } from '@/server/repository/paths'
import type { SourceStore } from '@/server/repository/source-store'
import type { RepositorySnapshot } from '@/server/repository/types'

export interface CodeRoute {
  /** URL pattern when the path is a literal or a resolvable constant; null otherwise. */
  route: string | null
  pagePath: string
  routerPath: string
}

export interface CodeRouteDiscovery {
  framework: string | null
  routes: CodeRoute[]
}

const MAX_ROUTER_FILES = 12
const MAX_CONSTANT_FILES = 4
const MAX_MANIFESTS = 40

const ROUTER_DEPENDENCY: Array<[RegExp, string]> = [
  [/"react-router(?:-dom)?"\s*:/, 'React Router (code routes)'],
  [/"vue-router"\s*:/, 'Vue Router (code routes)'],
  [/"@angular\/router"\s*:/, 'Angular Router (code routes)'],
]
const ROUTER_FILE = /\.(?:[jt]sx?|vue)$/i
const NOT_APP_CODE = /(?:^|\/)(?:testing|__stories__|__mocks__|__fixtures__)\//
const ROUTE_MARKER =
  /<Route\b|create(?:Browser|Hash|Memory)Router\s*\(|useRoutes\s*\(|RouterModule\.for(?:Root|Child)|createRouter\s*\(|\b[rR]outes\s*(?::\s*[\w<>[\]]+\s*)?[:=]\s*\[|RouteObject/

// String matching only: nothing is executed, and unresolvable parts stay null.
export async function discoverCodeRoutes(
  snapshot: RepositorySnapshot,
  store: SourceStore,
  manifestText: string,
): Promise<CodeRouteDiscovery> {
  const framework = ROUTER_DEPENDENCY.find(([pattern]) => pattern.test(manifestText))?.[1] ?? null
  if (!framework) return { framework: null, routes: [] }

  // Only packages that themselves depend on a router can declare its routes.
  const manifests = [...snapshot.entries.values()]
    .filter(
      (entry) =>
        entry.type === 'blob' &&
        /(?:^|\/)package\.json$/.test(entry.path) &&
        !isPeripheralPath(entry.path) &&
        !isGeneratedPath(entry.path),
    )
    .map((entry) => entry.path)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_MANIFESTS)
  await store.read(manifests)
  const routerRoots = manifests
    .filter((path) => ROUTER_DEPENDENCY.some(([pattern]) => pattern.test(store.getText(path) ?? '')))
    .map(dirname)
  const candidates = [...snapshot.entries.values()]
    .filter(
      (entry) =>
        entry.type === 'blob' &&
        ROUTER_FILE.test(entry.path) &&
        routerRoots.some((root) => !root || pathCovers(root, entry.path)) &&
        !NOT_APP_CODE.test(entry.path) &&
        !isPeripheralPath(entry.path) &&
        !isGeneratedPath(entry.path) &&
        !isSensitivePath(entry.path) &&
        routerScore(entry.path) > 0,
    )
    .map((entry) => entry.path)
    .sort((a, b) => routerScore(b) - routerScore(a) || a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_ROUTER_FILES)
  await store.read(candidates)

  const stems = new Map<string, string[]>()
  for (const entry of snapshot.entries.values()) {
    if (entry.type !== 'blob' || !/\.[cm]?[jt]sx?$/.test(entry.path)) continue
    const stem = entry.path.slice(entry.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    const list = stems.get(stem)
    if (list) list.push(entry.path)
    else stems.set(stem, [entry.path])
  }

  const declarations: Array<{ routerPath: string; path: string; component: string[]; specifier: string | null; imports: Map<string, string> }> = []
  for (const routerPath of candidates) {
    const text = store.getText(routerPath)
    if (!text || !ROUTE_MARKER.test(text)) continue
    const imports = importMap(text)
    for (const declaration of routeDeclarations(text)) declarations.push({ routerPath, imports, ...declaration })
  }

  // Constants used as paths (AppPath.Home): read the file defining the object, once.
  const constantFiles = new Map<string, string | null>()
  for (const { path } of declarations) {
    const object = /^([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*$/.exec(path)?.[1]
    if (!object || constantFiles.has(object) || constantFiles.size >= MAX_CONSTANT_FILES) continue
    const matches = stems.get(object) ?? []
    constantFiles.set(object, matches.length === 1 ? matches[0]! : null)
  }
  await store.read([...constantFiles.values()].filter((path): path is string => path !== null))

  const routes: CodeRoute[] = []
  const seen = new Set<string>()
  for (const declaration of declarations) {
    const pagePath = pageFileFor(declaration, store)
    if (!pagePath) continue
    const route = routeValue(declaration.path, constantFiles, store)
    // A page already found adds nothing through a route whose path is unknown.
    if (seen.has(`${route ?? ''}|${pagePath}`) || (route === null && seen.has(pagePath))) continue
    seen.add(`${route ?? ''}|${pagePath}`)
    seen.add(pagePath)
    routes.push({ route, pagePath, routerPath: declaration.routerPath })
  }
  return { framework, routes }
}

function routerScore(path: string): number {
  const name = path.slice(path.lastIndexOf('/') + 1)
  let score = 0
  if (/router|routes/i.test(name)) score += 3
  else if (/route/i.test(name)) score += 1
  if (/(?:^|\/)(?:routing|router|routes)\//i.test(path)) score += 2
  if (/^(?:App|app)\.(?:[jt]sx|vue)$/.test(name)) score += 1
  return score
}

export function importMap(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of text.matchAll(/import\s+([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"\n]+)['"]/g)) {
    if (match[1]) map.set(match[1], match[3]!)
    for (const part of (match[2] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1)
      if (name && /^[\w$]+$/.test(name)) map.set(name, match[3]!)
    }
  }
  for (const match of text.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:React\.)?lazy\s*\(\s*(?:async\s*)?\(\)\s*=>\s*import\(\s*['"]([^'"\n]+)['"]/g))
    map.set(match[1]!, match[2]!)
  return map
}

export function routeDeclarations(text: string): Array<{ path: string; component: string[]; specifier: string | null }> {
  const found: Array<{ path: string; component: string[]; specifier: string | null }> = []
  const pathValue = (raw: string) => raw.replace(/^\{|\}$/g, '').trim().replace(/^['"`]|['"`]$/g, '')

  for (const match of text.matchAll(/<Route\b([\s\S]{0,600}?)(?=<Route\b|<\/Route>|$)/g)) {
    const body = match[1]!
    const path = /\bpath\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\})/.exec(body)?.[1]
    if (!path) continue
    found.push({ path: pathValue(path), ...entryTargets(body) })
  }
  for (const match of text.matchAll(/\bpath\s*:\s*("[^"]*"|'[^']*'|`[^`$]*`|[A-Za-z_$][\w$.]*)([\s\S]{0,600}?)(?=\bpath\s*:|$)/g)) {
    const body = match[2]!
    if (!/\b(?:element|component|Component|loadComponent|lazy)\s*:/.test(body)) continue
    found.push({ path: pathValue(match[1]!), ...entryTargets(body) })
  }
  return found
}

// Props that render placeholders or errors, not the route's page.
const NON_PAGE_PROPS = /\b(?:fallback|loader|errorElement|pendingElement|hydrateFallbackElement)\s*[=:]\s*\{?\s*<[^>]*>\s*\}?/g
const WRAPPER_NAME = /(?:Loader|Skeleton|Layout|Redirect|Routes?|Router|Outlet|Provider|Suspense|Boundary|Guard|Wrapper|Navigate)$/

function entryTargets(raw: string): { component: string[]; specifier: string | null } {
  const body = raw.replace(NON_PAGE_PROPS, ' ')
  const specifier = /\b(?:loadComponent|component|lazy)\s*:\s*(?:async\s*)?\(\)\s*=>\s*import\(\s*['"]([^'"\n]+)['"]/.exec(body)?.[1] ?? null
  const component = [
    ...[...body.matchAll(/<([A-Z][\w$]*)[\s/>]/g)].map((match) => match[1]!),
    ...[...body.matchAll(/\b(?:component|Component|element)\s*[:=]\s*\{?\s*([A-Z][\w$]*)\b/g)].map((match) => match[1]!),
  ]
  return { component, specifier }
}

const PAGE_DIRECTORY = /(?:^|\/)(?:pages|views|screens|routes|containers)\//i

function pageFileFor(
  declaration: { routerPath: string; component: string[]; specifier: string | null; imports: Map<string, string> },
  store: SourceStore,
): string | null {
  if (declaration.specifier) return store.resolveImport(declaration.routerPath, declaration.specifier)
  const resolved = declaration.component
    .filter((name) => !WRAPPER_NAME.test(name))
    .map((name) => {
      const specifier = declaration.imports.get(name)
      return specifier ? store.resolveImport(declaration.routerPath, specifier) : null
    })
    .filter((path): path is string => path !== null)
  // Wrappers (layouts, lazy loaders, nested routers) are not pages; prefer a pages-like folder.
  return resolved.find((path) => PAGE_DIRECTORY.test(path)) ?? resolved.at(-1) ?? null
}

function routeValue(raw: string, constantFiles: Map<string, string | null>, store: SourceStore): string | null {
  if (raw.includes('${')) return null
  if (raw.startsWith('/') || raw === '' || raw === '*') return raw ? raw : '/'
  const member = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(raw)
  if (member) {
    const file = constantFiles.get(member[1]!)
    const text = file ? store.getText(file) : undefined
    const value = text ? new RegExp(`\\b${member[2]}\\s*[=:]\\s*['"\`]([^'"\`$\\n]*)['"\`]`).exec(text)?.[1] : undefined
    return value === undefined ? null : value.startsWith('/') ? value : `/${value}`
  }
  // A bare relative segment ("settings") from a nested route; keep it readable.
  return /^[\w:*.-][\w:*./-]*$/.test(raw) ? `/${raw}` : null
}

