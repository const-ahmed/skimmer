import { USER_FLOW_LIMITS } from '@/server/analysis/limits'
import { isGeneratedPath, isPeripheralPath, isSensitivePath } from '@/server/repository/paths'
import type { CodeRouteDiscovery } from './routes'
import type { TreeEntry } from '@/server/repository/types'

export interface PageEntry {
  path: string
  route: string | null
  framework: string
  /** Rendered by a route declared in code, so it is a real screen of the app. */
  routed?: boolean
}

export interface UiSurface {
  frameworks: string[]
  pages: PageEntry[]
  layouts: string[]
  /** Server endpoints addressable by URL, for mapping literal fetch/action targets. */
  endpoints: Array<{ path: string; route: string }>
}

interface PageRule {
  framework: string
  requires?: RegExp
  match: RegExp
  route: (match: RegExpExecArray) => string | null | undefined
}

const segmentsToRoute = (segments: string[]) =>
  `/${segments
    .filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith('@'))
    .map((segment) =>
      segment
        .replace(/^\[\[?\.\.\.(\w+)\]?\]$/, '*$1')
        .replace(/^\[(\w+)\]$/, ':$1'),
    )
    .join('/')}`

const flatRoute = (path: string) => {
  const segments = path
    .replace(/\.[^.]+$/, '')
    .split(/[/.]/)
    .filter((segment) => segment !== 'index' && segment !== '_index' && segment !== 'route')
  if (segments.some((segment) => segment.startsWith('-'))) return undefined
  return `/${segments
    .filter((segment) => !segment.startsWith('_') && !/^\(.*\)$/.test(segment))
    .map((segment) => (segment === '$' ? '*' : segment.replace(/^\$(\w+)$/, ':$1')))
    .join('/')}`
}

const PAGE_RULES: PageRule[] = [
  {
    framework: 'Next.js (app router)',
    requires: /"next"\s*:/,
    match: /^(?:(.*)\/)?app\/(?:(.*)\/)?page\.(?:[jt]sx?|mdx)$/,
    route: (m) => segmentsToRoute((m[2] ?? '').split('/')),
  },
  {
    framework: 'Next.js (pages router)',
    requires: /"next"\s*:/,
    match: /^(?:(.*)\/)?pages\/(.+)\.[jt]sx?$/,
    route: (m) =>
      /(?:^|\/)(?:_app|_document|_error)$|^api\//.test(m[2]!)
        ? undefined
        : segmentsToRoute(m[2]!.replace(/(?:^|\/)index$/, '').split('/')),
  },
  {
    framework: 'SvelteKit',
    match: /^(?:(.*)\/)?src\/routes\/(?:(.*)\/)?\+page\.svelte$/,
    route: (m) => segmentsToRoute((m[2] ?? '').split('/')),
  },
  {
    framework: 'TanStack Router',
    requires: /"@tanstack\/(?:react|solid)-router"\s*:/,
    match: /^(?:(.*)\/)?src\/routes\/(.+)\.[jt]sx$/,
    route: (m) => (/(?:^|\/)__root$|(?:^|\/)api\//.test(m[2]!.replace(/\.[^.]+$/, '')) ? undefined : flatRoute(m[2]!)),
  },
  {
    framework: 'React Router / Remix',
    requires: /"@(?:remix-run|react-router)\/[\w-]+"\s*:/,
    match: /^(?:(.*)\/)?app\/routes\/(.+)\.[jt]sx$/,
    route: (m) => flatRoute(m[2]!),
  },
  {
    framework: 'Nuxt',
    requires: /"nuxt"\s*:/,
    match: /^(?:(.*)\/)?pages\/(.+)\.vue$/,
    route: (m) => segmentsToRoute(m[2]!.replace(/(?:^|\/)index$/, '').split('/')),
  },
  {
    framework: 'Astro',
    requires: /"astro"\s*:/,
    match: /^(?:(.*)\/)?src\/pages\/(.+)\.astro$/,
    route: (m) => segmentsToRoute(m[2]!.replace(/(?:^|\/)index$/, '').split('/')),
  },
  {
    framework: 'Expo Router',
    requires: /"expo-router"\s*:/,
    match: /^(?:(.*)\/)?app\/(.+)\.[jt]sx$/,
    route: (m) =>
      /(?:^|\/)_layout$|\+/.test(m[2]!.replace(/\.[^.]+$/, ''))
        ? undefined
        : segmentsToRoute(m[2]!.replace(/(?:^|\/)index$/, '').split('/')),
  },
  {
    framework: 'Component views',
    requires: /"(?:react|vue|svelte|solid-js|preact|@angular\/core)"\s*:/,
    // Hooks, helpers and building blocks inside a views/ folder are not screens.
    match:
      /^(?:(.*)\/)?(?:pages|views|screens)\/(?:(?!(?:hooks|components|utils|types|constants|states?|graphql)\/)[^/]+\/)?(?!use[A-Z])[^/]+\.(?:[jt]sx|vue|svelte)$/,
    route: () => null,
  },
  {
    framework: 'Server-rendered templates',
    match:
      /^(?:(.*)\/)?(?:templates\/.+\.(?:html|jinja2?|j2|njk|twig)|app\/views\/.+\.erb|resources\/views\/.+\.blade\.php|views\/.+\.(?:ejs|pug|hbs|handlebars))$/,
    route: () => null,
  },
]

const LAYOUT =
  /^(?:(?:.*)\/)?(?:app\/layout\.[jt]sx|src\/routes\/__root\.[jt]sx|src\/routes\/\+layout\.svelte|app\/root\.[jt]sx|layouts\/default\.vue|app\.vue|src\/App\.(?:[jt]sx|vue|svelte)|app\/_layout\.[jt]sx|templates\/base\.html)$/

const ENDPOINT_RULES: Array<{ match: RegExp; route: (m: RegExpExecArray) => string }> = [
  { match: /^(?:.*\/)?app\/(?:(.*)\/)?route\.[jt]s$/, route: (m) => segmentsToRoute((m[1] ?? '').split('/')) },
  { match: /^(?:.*\/)?pages\/(api\/.+)\.[jt]s$/, route: (m) => segmentsToRoute(m[1]!.replace(/\/index$/, '').split('/')) },
  { match: /^(?:.*\/)?src\/routes\/(?:(.*)\/)?\+server\.[jt]s$/, route: (m) => segmentsToRoute((m[1] ?? '').split('/')) },
  { match: /^(?:.*\/)?src\/routes\/(api\/.+)\.[jt]sx?$/, route: (m) => flatRoute(m[1]!) ?? '' },
  { match: /^(?:.*\/)?server\/(api|routes)\/(.+)\.[jt]s$/, route: (m) => segmentsToRoute(`${m[1] === 'api' ? 'api/' : ''}${m[2]!.replace(/(?:^|\/)index$/, '').replace(/\.(?:get|post|put|patch|delete)$/, '')}`.split('/')) },
]

function eligible(path: string): boolean {
  return !isPeripheralPath(path) && !isGeneratedPath(path) && !isSensitivePath(path)
}

// Null means no user-facing surface (libraries, CLIs, services), so no User Flow call is made.
export function detectUiSurface(
  entries: ReadonlyMap<string, TreeEntry>,
  manifestText: string,
): UiSurface | null {
  const surface = scanUiSurface(entries, manifestText)
  return surface.pages.length ? surface : null
}

/** detectUiSurface without the "no pages" shortcut, for merging code routes. */
export function scanUiSurface(entries: ReadonlyMap<string, TreeEntry>, manifestText: string): UiSurface {
  const pages: PageEntry[] = []
  const layouts: string[] = []
  const endpoints: UiSurface['endpoints'] = []
  const frameworks = new Set<string>()
  const claimed = new Set<string>()
  const blobs = [...entries.values()].filter((entry) => entry.type === 'blob' && eligible(entry.path))

  for (const rule of PAGE_RULES) {
    if (rule.requires && !rule.requires.test(manifestText)) continue
    for (const { path } of blobs) {
      if (claimed.has(path)) continue
      const match = rule.match.exec(path)
      if (!match) continue
      const route = rule.route(match)
      if (route === undefined) continue
      pages.push({ path, route, framework: rule.framework })
      frameworks.add(rule.framework)
      claimed.add(path)
    }
  }
  for (const { path } of blobs) {
    if (LAYOUT.test(path)) layouts.push(path)
    for (const rule of ENDPOINT_RULES) {
      const match = rule.match.exec(path)
      if (match) {
        endpoints.push({ path, route: rule.route(match) })
        break
      }
    }
  }
  if (!pages.length) {
    const index = blobs.find((entry) => /^(?:(?:public|src)\/)?index\.html$/.test(entry.path))
    if (index) {
      pages.push({ path: index.path, route: '/', framework: 'Static HTML' })
      frameworks.add('Static HTML')
    }
  }
  return { frameworks: [...frameworks], pages, layouts: layouts.slice(0, 3), endpoints }
}

const IMPORTANT_ROUTE =
  /new|create|edit|settings|profile|account|checkout|cart|order|upload|search|editor|dashboard|compose|chat|generate|builder|submit|book|pay|share|contact/i
const PERIPHERAL_ROUTE =
  /terms|privacy|legal|cookie|404|500|not-found|error|changelog|blog|docs|licen[cs]e|sitemap|robots|status|health|debug/i

export function mergeCodeRoutes(surface: UiSurface, discovery: CodeRouteDiscovery): UiSurface | null {
  const pages = surface.pages.map((page) => ({ ...page }))
  const byPath = new Map(pages.map((page) => [page.path, page]))
  for (const { route, pagePath } of discovery.routes) {
    const existing = byPath.get(pagePath)
    if (existing) {
      existing.routed = true
      existing.route ??= route
      continue
    }
    const page: PageEntry = { path: pagePath, route, framework: discovery.framework ?? 'Code routes', routed: true }
    pages.push(page)
    byPath.set(pagePath, page)
  }
  const frameworks = discovery.routes.length && discovery.framework
    ? [...new Set([...surface.frameworks, discovery.framework])]
    : surface.frameworks
  return pages.length ? { ...surface, frameworks, pages } : null
}

// Sign-in, sign-up and onboarding screens: real, but a gate to the product
// rather than the product, and numerous enough to fill every slot.
const ENTRY_WORDS = new Set([
  'auth', 'signin', 'signup', 'sign', 'login', 'logout', 'register', 'registration', 'onboarding', 'onboard',
  'invite', 'invitation', 'verify', 'verification', 'password', 'forgot', 'otp', '2fa', 'mfa', 'sso',
])
const ENTRY_PAGE_CAP = Math.max(1, Math.floor(USER_FLOW_LIMITS.maxPages / 4))
const SECTION_PENALTY = 12

function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function isEntryPage(page: PageEntry): boolean {
  return wordsOf(`${page.route ?? ''} ${page.path}`).some((word) => ENTRY_WORDS.has(word))
}

// From the file location, not the route: code routes are often declared relative to a parent route.
export function sectionOf(page: PageEntry): string {
  const segments = page.path.split('/')
  const base = segments.findLastIndex(
    (segment, index) => index < segments.length - 1 && /^(?:pages|views|screens|routes|app|modules)$/.test(segment),
  )
  if (base === -1) return segments.slice(0, -1).join('/')
  const area = segments.slice(base + 1, -1).find((segment) => !/^\(.*\)$/.test(segment))
  return [...segments.slice(0, base + 1), area ?? ''].join('/')
}

// Each page already taken from an area costs the next one SECTION_PENALTY; entry pages beyond ENTRY_PAGE_CAP come last.
export function pickPages(
  pages: readonly PageEntry[],
  scoreOf: (page: PageEntry, index: number) => number,
  limit: number,
): PageEntry[] {
  const pool = pages.map((page, index) => ({ page, base: scoreOf(page, index), entry: isEntryPage(page), section: sectionOf(page) }))
  const sections = new Map<string, number>()
  const picked: PageEntry[] = []
  let entries = 0
  while (picked.length < limit && pool.length) {
    let best = 0
    let bestScore = -Infinity
    pool.forEach((candidate, index) => {
      const score =
        candidate.base -
        SECTION_PENALTY * (sections.get(candidate.section) ?? 0) -
        (candidate.entry && entries >= ENTRY_PAGE_CAP ? 1_000 : 0)
      if (score > bestScore || (score === bestScore && candidate.page.path < pool[best]!.page.path)) {
        best = index
        bestScore = score
      }
    })
    const [chosen] = pool.splice(best, 1)
    picked.push(chosen!.page)
    sections.set(chosen!.section, (sections.get(chosen!.section) ?? 0) + 1)
    if (chosen!.entry) entries++
  }
  return picked
}

/** Name-based ranking of pages; content-based reranking happens after reading. */
export function rankPages(pages: readonly PageEntry[]): PageEntry[] {
  const score = (page: PageEntry) => {
    const key = page.route ?? page.path
    const words = `${page.route ?? ''} ${page.path}`
    let value = 0
    if (page.route === '/') value += 30
    if (page.routed) value += 15
    if (IMPORTANT_ROUTE.test(key)) value += 20
    if (PERIPHERAL_ROUTE.test(words)) value -= 40
    if (/[:*]/.test(key)) value -= 5
    value -= 3 * key.split('/').filter(Boolean).length
    return value
  }
  return pickPages(pages, score, pages.length)
}

// Static segments beat parameters, as routers do.
export function matchEndpoint(
  url: string,
  endpoints: UiSurface['endpoints'],
): string | null {
  const target = url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').filter(Boolean)
  let best: { path: string; score: number } | null = null
  for (const endpoint of endpoints) {
    const pattern = endpoint.route.split('/').filter(Boolean)
    const catchAll = pattern.at(-1)?.startsWith('*')
    if (!catchAll && pattern.length !== target.length) continue
    if (catchAll && target.length < pattern.length - 1) continue
    let score = 0
    const matches = pattern.every((segment, index) => {
      const part = target[index] ?? ''
      if (segment === part) {
        score += 2
        return true
      }
      if (segment.startsWith(':') || /^\$\{/.test(part)) {
        score += 1
        return true
      }
      return segment.startsWith('*')
    })
    if (matches && (!best || score > best.score)) best = { path: endpoint.path, score }
  }
  return best?.path ?? null
}
