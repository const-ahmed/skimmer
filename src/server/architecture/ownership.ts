import { pathCovers } from '@/server/repository/paths'
import type { ArchitectureNode } from './schema'

// The deepest node whose primaryPath contains the path. Identical paths tie-break on the smallest id, so the model's node order does not matter.
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
