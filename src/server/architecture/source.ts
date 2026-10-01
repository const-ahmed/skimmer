import type { EvidenceScope } from '@/server/evidence/scope'
import { isSourcePath, pathCovers } from '@/server/repository/paths'
import { rankArchitecturePaths } from '@/server/repository/ranking'
import type { StaticReference, TreeEntry } from '@/server/repository/types'
import { githubBlobUrl, githubTreeUrl } from '@/shared/evidence-links'
import { ownerOf } from './ownership'
import type { ArchitectureNode, SourceTarget } from './schema'

export interface SourceSelectionContext {
  repository: { owner: string; repo: string; commitSha: string }
  entries: ReadonlyMap<string, TreeEntry>
  scope: EvidenceScope
  references: readonly StaticReference[]
  nodes: readonly Pick<ArchitectureNode, 'id' | 'primaryPath'>[]
}

const EXTERNAL_KINDS = new Set<ArchitectureNode['kind']>(['external-actor', 'external-service'])

/**
 * The one source location to open for a node, preferring the most direct
 * evidence and always preferring a file to a directory:
 *
 * 1. the first cited range in a shown source file the node owns (not the
 *    README, and not a file of another component, such as a root manifest);
 * 2. the first file the node owns that the analysis read (its imports were
 *    resolved, so it is real code of this component);
 * 3. primaryPath, when it is a file;
 * 4. the best file inside primaryPath by the architecture path ranking,
 *    counting only files this node owns (a nested node's files are its own);
 * 5. the first cited range anywhere else;
 * 6. primaryPath itself, when it is a directory;
 * 7. nothing, for external actors and services or a node with no path.
 */
export function selectPrimarySource(
  node: Pick<ArchitectureNode, 'id' | 'kind' | 'primaryPath' | 'evidence'>,
  context: SourceSelectionContext,
): SourceTarget | null {
  if (EXTERNAL_KINDS.has(node.kind)) return null
  const file = (
    path: string,
    basis: SourceTarget['basis'],
    lines?: { startLine: number; endLine: number },
  ): SourceTarget => ({
    path,
    type: 'file',
    ...lines,
    basis,
    url: githubBlobUrl({ ...context.repository, path, ...lines }),
  })

  const cited = node.evidence.filter(
    (item) => item.origin === 'model' && context.scope.files.get(item.path)?.kind === 'source',
  )
  const citedFile = (item: (typeof cited)[number]) =>
    file(item.path, 'cited', { startLine: item.startLine, endLine: item.endLine })
  const ownCitation = cited.find((item) => ownerOf(item.path, context.nodes) === node.id)
  if (ownCitation) return citedFile(ownCitation)

  const owned = context.references.find((reference) => ownerOf(reference.fromPath, context.nodes) === node.id)
  if (owned) return file(owned.fromPath, 'static-reference')

  const primary = node.primaryPath
  const entry = primary ? context.entries.get(primary) : undefined
  if (entry?.type === 'blob') return file(primary!, 'primary-path')
  if (!primary || !entry) return cited[0] ? citedFile(cited[0]) : null

  const inside = new Map<string, TreeEntry>()
  for (const [path, candidate] of context.entries)
    if (
      candidate.type === 'blob' &&
      pathCovers(primary, path) &&
      isSourcePath(path) &&
      ownerOf(path, context.nodes) === node.id
    )
      inside.set(path, candidate)
  const [best] = rankArchitecturePaths(inside, 1)
  if (best) return file(best, 'ranked-file')
  if (cited[0]) return citedFile(cited[0])

  return { path: primary, type: 'directory', basis: 'directory', url: githubTreeUrl({ ...context.repository, path: primary }) }
}
