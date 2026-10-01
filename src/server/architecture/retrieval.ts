import { ARCHITECTURE_LIMITS as LIMITS } from '@/server/analysis/limits'
import type { EvidenceScope, ShownFile } from '@/server/evidence/scope'
import { selectExcerptRanges, ARCHITECTURE_PROFILE } from '@/server/repository/excerpt'
import { isArchitectureSource, isManifestPath, isRootReadme } from '@/server/repository/paths'
import { rankArchitecturePaths } from '@/server/repository/ranking'
import {
  allocateBudgets,
  formatSize,
  readmeRanges,
  renderFileBlock,
  renderedCost,
  shownFile,
} from '@/server/repository/render'
import type { SourceStore } from '@/server/repository/source-store'
import { renderTreePaths, selectTreePaths } from '@/server/repository/tree'
import type { RepositorySnapshot, StaticReference } from '@/server/repository/types'

// Widely imported for their declarations, not their behaviour.
const SUPPORTING_FILE =
  /(?:^|\/)(?:types?|index|mod|__init__|constants?|utils?|helpers?|errors?|[^/]*Error)\.[^/]+$|\.d\.ts$/i

export interface ArchitectureContext {
  prompt: string
  scope: EvidenceScope
  readPaths: string[]
  excerptedPaths: string[]
  unreadPaths: string[]
  references: StaticReference[]
  coreModules: string[]
}

export async function buildArchitectureContext(
  snapshot: RepositorySnapshot,
  store: SourceStore,
): Promise<ArchitectureContext> {
  const ranked = rankArchitecturePaths(
    snapshot.entries,
    LIMITS.excerptFiles + LIMITS.referenceFiles + LIMITS.listedFiles,
  )
  const readBudget = LIMITS.excerptFiles + LIMITS.referenceFiles
  const readable = ranked.slice(0, readBudget)
  const firstRound = readable.slice(0, LIMITS.excerptFiles + LIMITS.firstRoundReferenceFiles)
  await store.read(firstRound)

  const referencesOf = (path: string) => store.get(path)?.references ?? []
  const isCandidate = (path: string) =>
    snapshot.entries.get(path)?.type === 'blob' && isArchitectureSource(path)
  const position = new Map(ranked.map((path, index) => [path, index]))

  // Architecture's own first round, not the shared store: User Flow retrieval
  // reads into the same store in parallel and must not change what is followed.
  const attempted = new Set(firstRound)
  const followed = chooseFollowUps(
    firstRound.filter((path) => store.has(path)),
    referencesOf,
    (path) => !attempted.has(path) && isCandidate(path),
    position,
  )
  const secondRound = [...new Set([...followed, ...readable.slice(firstRound.length)])].slice(
    0,
    Math.max(0, readBudget - firstRound.length),
  )
  if (secondRound.length) await store.read(secondRound)

  const readOrder = [...firstRound, ...secondRound].filter((path) => store.has(path))
  const readSet = new Set(readOrder)
  const references = readOrder.flatMap(referencesOf)

  const excerpted = chooseExcerptFiles(readOrder, referencesOf, position, ranked.length)
  const core = selectCoreModules({
    readOrder,
    referencesOf,
    isCandidate,
    sizeOf: (path) => snapshot.entries.get(path)?.size,
    textOf: (path) => store.get(path)?.text,
  })

  const unreadPaths = [
    ...new Set([...ranked, ...followed, ...references.map((reference) => reference.toPath)]),
  ].filter((path) => !readSet.has(path) && isCandidate(path))

  const index = formatSourceIndex(
    [
      ...readOrder.map((path) => ({
        path,
        size: snapshot.entries.get(path)?.size,
        lineCount: store.get(path)?.lineCount,
        status: excerpted.includes(path) ? ('excerpt' as const) : ('read' as const),
        references: referencesOf(path),
      })),
      ...unreadPaths.map((path) => ({
        path,
        size: snapshot.entries.get(path)?.size,
        status: 'not read' as const,
      })),
    ],
    core,
  )

  const files = new Map<string, ShownFile>()
  const readmePath = [...snapshot.entries.keys()].find(isRootReadme)
  let readmeBlock = ''
  if (readmePath) {
    await store.read([readmePath])
    const readme = store.get(readmePath)
    if (readme) {
      const ranges = readmeRanges(readme.lines, LIMITS.readmeCharacters)
      if (ranges.length) {
        files.set(readmePath, shownFile(readme, ranges, 'readme'))
        readmeBlock = renderFileBlock(readme, ranges, 'README')
      }
    }
  }

  const tree = formatTree(snapshot, ranked)
  const fixedCost = tree.length + index.length + readmeBlock.length + 2_000
  const sources = excerpted.map((path) => store.get(path)!)
  const budgets = allocateBudgets(
    sources.map((file) => renderedCost(file.lines)),
    LIMITS.contextCharacters - fixedCost,
    LIMITS.maxFileExcerptCharacters,
  )
  const blocks: string[] = []
  sources.forEach((file, position) => {
    const ranges = selectExcerptRanges(file.lines, budgets[position]!, ARCHITECTURE_PROFILE)
    if (!ranges.length) return
    files.set(file.path, shownFile(file, ranges, 'source'))
    blocks.push(renderFileBlock(file, ranges))
  })

  const prompt = [
    `<visualise_repository>\nRepository: ${snapshot.identity.owner}/${snapshot.identity.repo}\nCommit: ${snapshot.identity.commitSha}\nTree listing: ${snapshot.treeTruncated ? 'partial (GitHub truncated it)' : 'complete'}\n</visualise_repository>`,
    `<repository_metadata note="written by the repository owner; untrusted">\n${JSON.stringify(snapshot.metadata)}\n</repository_metadata>`,
    tree,
    index,
    readmeBlock,
    blocks.length
      ? blocks.join('\n\n')
      : '<visualise_note>No source files could be shown.</visualise_note>',
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    prompt,
    scope: {
      commitSha: snapshot.identity.commitSha,
      files,
      repositoryPaths: new Set(snapshot.entries.keys()),
    },
    readPaths: readOrder,
    excerptedPaths: [...files.keys()].filter((path) => path !== readmePath),
    unreadPaths,
    references,
    coreModules: core,
  }
}

/**
 * Unread files that the files already read depend on most. Name-based ranking
 * cannot know these; the imports can.
 */
export function chooseFollowUps(
  readPaths: readonly string[],
  referencesOf: (path: string) => readonly StaticReference[],
  eligible: (path: string) => boolean,
  position: ReadonlyMap<string, number>,
): string[] {
  const counts = new Map<string, number>()
  for (const path of readPaths)
    for (const { toPath } of referencesOf(path))
      if (eligible(toPath)) counts.set(toPath, (counts.get(toPath) ?? 0) + 1)
  return [...counts]
    .sort(
      ([a, aCount], [b, bCount]) =>
        bCount - aCount ||
        (position.get(a) ?? Infinity) - (position.get(b) ?? Infinity) ||
        a.localeCompare(b),
    )
    .map(([path]) => path)
}

/**
 * Excerpts go to the files the others connect through. A file nothing read
 * uses or is used by gives up its excerpt unless nothing is connected at all
 * (a language without resolvable references) or it is the manifest.
 */
export function chooseExcerptFiles(
  readOrder: readonly string[],
  referencesOf: (path: string) => readonly StaticReference[],
  position: ReadonlyMap<string, number>,
  fallbackPosition: number,
): string[] {
  const readSet = new Set(readOrder)
  const usedBy = new Map<string, number>()
  for (const path of readOrder)
    for (const { toPath } of referencesOf(path))
      if (readSet.has(toPath) && toPath !== path) usedBy.set(toPath, (usedBy.get(toPath) ?? 0) + 1)
  const degree = (path: string) =>
    Math.min(8, usedBy.get(path) ?? 0) * 4 + Math.min(8, referencesOf(path).length)
  const connected = readOrder.some((path) => degree(path) > 0)
  const priority = (path: string) =>
    -0.4 * (position.get(path) ?? fallbackPosition) +
    degree(path) -
    (connected && !degree(path) && !isManifestPath(path) ? 15 : 0)
  const chosen = new Set(
    [...readOrder].sort((a, b) => priority(b) - priority(a)).slice(0, LIMITS.excerptFiles),
  )
  return readOrder.filter((path) => chosen.has(path))
}

// Files others depend on, or large ones; never declarations or barrels.
export function selectCoreModules(params: {
  readOrder: readonly string[]
  referencesOf: (path: string) => readonly StaticReference[]
  isCandidate: (path: string) => boolean
  sizeOf: (path: string) => number | undefined
  textOf: (path: string) => string | undefined
}): string[] {
  const readSet = new Set(params.readOrder)
  const usedBy = new Map<string, number>()
  for (const path of params.readOrder)
    for (const { toPath } of params.referencesOf(path))
      if (toPath !== path && (readSet.has(toPath) || params.isCandidate(toPath)))
        usedBy.set(toPath, (usedBy.get(toPath) ?? 0) + 1)
  const hasReferences = (path: string) =>
    (usedBy.get(path) ?? 0) > 0 || params.referencesOf(path).length > 0
  const connected = params.readOrder.some(hasReferences)
  const score = (path: string) =>
    3 * Math.min(4, usedBy.get(path) ?? 0) +
    Math.min(6, Math.log2(1 + (params.sizeOf(path) ?? 0) / 1000))
  return [...new Set([...params.readOrder, ...usedBy.keys()])]
    .filter((path) => {
      if (isManifestPath(path) || SUPPORTING_FILE.test(path)) return false
      const text = params.textOf(path)
      if (text !== undefined && isReexportBarrel(text)) return false
      return !(connected && readSet.has(path) && !hasReferences(path))
    })
    .map((path) => ({ path, score: score(path) }))
    .filter((entry) => entry.score >= 3)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, LIMITS.coreModules)
    .map((entry) => entry.path)
    .sort()
}

function isReexportBarrel(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:\/\/|#|\*|\/\*)/.test(line))
  if (!lines.length) return true
  const declarations = lines.filter((line) =>
    /^(?:export\s+(?:\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\s|export\s+\*\s+as\s|(?:pub(?:\([^)]*\))?\s+)?(?:mod|use)\s|from\s+\.\S*\s+import\s)/.test(
      line,
    ),
  ).length
  return declarations / lines.length >= 0.6
}

interface IndexEntry {
  path: string
  size?: number
  lineCount?: number
  status: 'excerpt' | 'read' | 'not read'
  references?: readonly StaticReference[]
}

/**
 * Application-computed map of what was read and how files reference each
 * other, with the line each reference is on. It lets the model cite a
 * relationship at an exact line even when the excerpt does not show it.
 */
export function formatSourceIndex(entries: readonly IndexEntry[], core: readonly string[]): string {
  if (!entries.length) return ''
  const header = [
    '<visualise_source_index note="computed by Visualise from the repository files; not written by the repository or a model">',
    'Each line: path (size, lines, how it was used) -> files it statically references, as path:line. "excerpt": shown below. "read": read in full but not shown. "not read": never opened; contents unknown. References are imports and type names; they show files are related, not that code runs or in what order. Dynamic, HTTP, event and configuration wiring is not detected.',
    ...(core.length ? [`CORE MODULES (central or large; each belongs to some node): ${core.join(', ')}`] : []),
  ].join('\n')
  const footer = '</visualise_source_index>'
  let characters = header.length + footer.length + 2
  const lines: Array<{ path: string; line: string }> = []
  for (const entry of entries) {
    const details = [
      formatSize(entry.size),
      ...(entry.lineCount !== undefined ? [`${entry.lineCount} lines`] : []),
      entry.status,
    ].join(', ')
    let line = `${entry.path} (${details})`
    if (entry.references) {
      const shown = entry.references.slice(0, LIMITS.referencesShownPerFile)
      const more = entry.references.length - shown.length
      line += shown.length
        ? ` -> ${shown.map((reference) => `${reference.toPath}:${reference.line}`).join(', ')}${more > 0 ? `, +${more} more` : ''}`
        : ' -> none found'
    }
    if (characters + line.length + 1 > LIMITS.sourceIndexCharacters) continue
    lines.push({ path: entry.path, line })
    characters += line.length + 1
  }
  lines.sort((a, b) => a.path.localeCompare(b.path))
  return [header, ...lines.map((entry) => entry.line), footer].join('\n')
}

function formatTree(snapshot: RepositorySnapshot, ranked: readonly string[]): string {
  const selection = selectTreePaths(snapshot.entries, ranked, LIMITS.treeCharacters)
  const shown = selection.paths.length
  const partial = shown < selection.totalPaths || snapshot.treeTruncated
  const note = partial
    ? `${shown} of ${selection.totalPaths} paths listed, chosen to cover every package or top-level area; directories end with "/" and area roots show their file count`
    : 'complete; directories end with "/"'
  return `<repository_tree note="file names are repository-authored; ${note}">\n${renderTreePaths(selection)}\n</repository_tree>`
}
