import { USER_FLOW_LIMITS as LIMITS } from '@/server/analysis/limits'
import type { EvidenceScope, ShownFile } from '@/server/evidence/scope'
import { selectExcerptRanges, USER_FLOW_PROFILE } from '@/server/repository/excerpt'
import { isGeneratedPath, isPeripheralPath, isRootReadme } from '@/server/repository/paths'
import {
  allocateBudgets,
  readmeRanges,
  renderFileBlock,
  renderedCost,
  shownFile,
} from '@/server/repository/render'
import type { SourceStore } from '@/server/repository/source-store'
import type { RepositorySnapshot } from '@/server/repository/types'
import { matchEndpoint, pickPages, rankPages, type PageEntry, type UiSurface } from './surface'

const UI_COMPONENT = /\.(?:[jt]sx|vue|svelte|astro)$/i
const HOOK = /(?:^|\/)use[A-Z][\w-]*\.[cm]?[jt]sx?$/
const NOT_A_COMPONENT =
  /(?:^|\/)(?:types?|constants?|utils?|helpers?|styles?|theme|icons?|config)(?:\.[^/]+)?$|\.(?:css|scss|d\.ts)$|(?:^|\/)(?:ui|icons?)\//i
const SERVER_SIDE =
  /(?:^|\/)(?:api|server|actions?|handlers?|functions)\/|\.server\.[cm]?[jt]sx?$|(?:^|\/)actions?\.[cm]?[jt]s$/
const SERVER_MARKER = /["']use server["']|\bcreateServerFn\b/
const LITERAL_URL = /["'`](\/[A-Za-z0-9_\-/.:$[\]{}]*)["'`]/g
const FORM_ACTION = /\baction=\{?["'`](\/[^"'`\s]*)["'`]/g

export type FileRole = 'page' | 'layout' | 'child' | 'handler'

export interface UserFlowFile {
  path: string
  role: FileRole
  note: string
}

export interface UserFlowContext {
  prompt: string
  scope: EvidenceScope
  surface: { frameworks: string[]; routes: string[] }
  files: UserFlowFile[]
}

export function uiSignalScore(text: string): number {
  let score = 0
  for (const signal of USER_FLOW_PROFILE.signals) {
    const global = new RegExp(signal.pattern.source, signal.pattern.flags.includes('g') ? signal.pattern.flags : `${signal.pattern.flags}g`)
    score += Math.min(10, text.match(global)?.length ?? 0) * (signal.score / 100)
  }
  return score
}

// Nothing is crawled recursively, and URL strings are matched to repository paths, never requested.
export async function buildUserFlowContext(
  snapshot: RepositorySnapshot,
  store: SourceStore,
  surface: UiSurface,
): Promise<UserFlowContext> {
  const byName = rankPages(surface.pages).slice(0, LIMITS.maxPages * 2)
  await store.read([...byName.map((page) => page.path), ...surface.layouts])
  const pages = selectPages(byName, (path) => store.get(path)?.text)

  const files: UserFlowFile[] = []
  const included = new Set<string>()
  const include = (path: string, role: FileRole, note: string) => {
    if (included.has(path) || files.length >= LIMITS.maxFiles || !store.has(path)) return
    included.add(path)
    files.push({ path, role, note })
  }
  for (const page of pages)
    include(page.path, 'page', page.route ? `page for route ${page.route}` : 'page or view')
  for (const layout of surface.layouts) include(layout, 'layout', 'top-level layout or shell')

  const childCandidates = new Map<string, string[]>()
  for (const page of pages) {
    const candidates = (store.get(page.path)?.references ?? [])
      .map((reference) => reference.toPath)
      .filter(
        (path) =>
          !included.has(path) &&
          (UI_COMPONENT.test(path) || HOOK.test(path)) &&
          !NOT_A_COMPONENT.test(path) &&
          !SERVER_SIDE.test(path) &&
          !isPeripheralPath(path) &&
          !isGeneratedPath(path),
      )
      .slice(0, LIMITS.maxChildComponentsPerPage * 2)
    childCandidates.set(page.path, candidates)
  }
  await store.read([...childCandidates.values()].flat())
  for (const page of pages) {
    const children = (childCandidates.get(page.path) ?? [])
      .filter((path) => store.has(path))
      .map((path) => ({ path, score: uiSignalScore(store.get(path)!.text) }))
      .filter((child) => child.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMITS.maxChildComponentsPerPage)
    for (const child of children) include(child.path, 'child', `used by ${page.path}`)
  }

  const handlerCandidates: Array<{ path: string; note: string }> = []
  for (const file of [...files]) {
    const source = store.get(file.path)
    if (!source) continue
    const found: Array<{ path: string; note: string }> = []
    for (const pattern of [LITERAL_URL, FORM_ACTION])
      for (const match of source.text.matchAll(pattern)) {
        const endpoint = matchEndpoint(match[1]!, surface.endpoints)
        if (endpoint) found.push({ path: endpoint, note: `endpoint for ${match[1]} referenced in ${file.path}` })
      }
    for (const reference of source.references)
      if (SERVER_SIDE.test(reference.toPath))
        found.push({ path: reference.toPath, note: `server code imported by ${file.path}` })
    handlerCandidates.push(
      ...dedupe(found).filter((candidate) => !included.has(candidate.path)).slice(0, LIMITS.maxHandlersPerPage),
    )
  }
  await store.read(handlerCandidates.map((candidate) => candidate.path))
  for (const candidate of dedupe(handlerCandidates)) include(candidate.path, 'handler', candidate.note)

  // Imported modules that declare themselves server functions also count.
  for (const file of files.filter((entry) => entry.role !== 'handler'))
    for (const reference of store.get(file.path)?.references ?? [])
      if (!included.has(reference.toPath) && SERVER_MARKER.test(store.getText(reference.toPath) ?? ''))
        include(reference.toPath, 'handler', `server function imported by ${file.path}`)

  const scopeFiles = new Map<string, ShownFile>()
  const readmePath = [...snapshot.entries.keys()].find(isRootReadme)
  let readmeBlock = ''
  if (readmePath) {
    await store.read([readmePath])
    const readme = store.get(readmePath)
    const ranges = readme ? readmeRanges(readme.lines, LIMITS.readmeCharacters) : []
    if (readme && ranges.length) {
      scopeFiles.set(readmePath, shownFile(readme, ranges, 'readme'))
      readmeBlock = renderFileBlock(readme, ranges, 'README')
    }
  }

  const routes = surface.pages
    .filter((page) => page.route !== null)
    .slice(0, LIMITS.maxRoutesListed)
    .map((page) => `${page.route} -> ${page.path}`)
  const surfaceBlock = [
    '<visualise_surface note="computed by Visualise from file names and imports">',
    `Detected UI: ${surface.frameworks.join(', ')}`,
    routes.length ? `Routes found (${routes.length}${surface.pages.length > routes.length ? `, of ${surface.pages.length} pages` : ''}):\n${routes.join('\n')}` : 'Routing is not file-based; pages are listed by file.',
    'Files shown below and why they were chosen:',
    ...files.map((file) => `${file.path} [${file.role}] ${file.note}`),
    '</visualise_surface>',
  ].join('\n')

  const sources = files.map((file) => store.get(file.path)!)
  const budgets = allocateBudgets(
    sources.map((file) => renderedCost(file.lines)),
    LIMITS.contextCharacters - surfaceBlock.length - readmeBlock.length - 2_000,
    LIMITS.maxFileExcerptCharacters,
  )
  const blocks: string[] = []
  sources.forEach((file, index) => {
    const ranges = selectExcerptRanges(file.lines, budgets[index]!, USER_FLOW_PROFILE)
    if (!ranges.length) return
    scopeFiles.set(file.path, shownFile(file, ranges, 'source'))
    blocks.push(renderFileBlock(file, ranges, files[index]!.role))
  })

  return {
    prompt: [surfaceBlock, readmeBlock, ...blocks].filter(Boolean).join('\n\n'),
    scope: {
      commitSha: snapshot.identity.commitSha,
      files: scopeFiles,
      repositoryPaths: new Set(snapshot.entries.keys()),
    },
    surface: {
      frameworks: surface.frameworks,
      routes: surface.pages.flatMap((page) => (page.route === null ? [] : [page.route])),
    },
    files: files.filter((file) => scopeFiles.has(file.path)),
  }
}

export function selectPages(
  ranked: readonly PageEntry[],
  textOf: (path: string) => string | undefined,
): PageEntry[] {
  const readable = ranked.filter((page) => textOf(page.path) !== undefined)
  return pickPages(
    readable,
    (page, index) => uiSignalScore(textOf(page.path)!) - index * 0.5 + (page.route === '/' ? 5 : 0) + (page.routed ? 5 : 0),
    LIMITS.maxPages,
  )
}

function dedupe<T extends { path: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => (seen.has(item.path) ? false : (seen.add(item.path), true)))
}
