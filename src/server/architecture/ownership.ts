import { pathCovers } from '@/server/repository/paths'
import type { ArchitectureNode } from './schema'

/**
 * The node that owns a repository path: of all nodes whose primaryPath is the
 * path or one of its folders, the deepest. A broad directory node owns only
 * what no more specific node claims. Only nodes with an identical primaryPath
 * can tie; the lexicographically smallest id wins so the result does not
 * depend on the model's node order.
 */
export function ownerOf(
  path: string,
  nodes: readonly Pick<ArchitectureNode, 'id' | 'primaryPath'>[],
): string | null {
  let owner: { id: string; depth: number } | null = null
  for (const node of nodes) {
    if (!node.primaryPath || !pathCovers(node.primaryPath, path)) continue
    const depth = node.primaryPath.split('/').length
    if (!owner || depth > owner.depth || (depth === owner.depth && node.id < owner.id))
      owner = { id: node.id, depth }
  }
  return owner?.id ?? null
}
