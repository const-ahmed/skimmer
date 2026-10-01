import type { ArchitectureNode, ArchitectureResult } from '@/server/architecture/schema'

type ArchitectureGroup = ArchitectureResult['graph']['groups'][number]

export interface OutlineSection {
  /** null: components outside any group. */
  group: ArchitectureGroup | null
  nodes: ArchitectureNode[]
}

/**
 * Diagram order as a list: longest path over the edges, with cycles broken in
 * model order and unconnected nodes last. Groups stay together.
 */
export function readingOrder(graph: ArchitectureResult['graph']): OutlineSection[] {
  const ids = graph.nodes.map((node) => node.id)
  const index = new Map(ids.map((id, position) => [id, position]))
  const targets = new Map(ids.map((id) => [id, [] as string[]]))
  for (const edge of graph.edges)
    if (edge.from !== edge.to && index.has(edge.to)) targets.get(edge.from)?.push(edge.to)

  const forward: Array<[string, string]> = []
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string) => {
    state.set(id, 'open')
    for (const to of targets.get(id)!) {
      if (state.get(to) === 'open') continue
      forward.push([id, to])
      if (!state.has(to)) visit(to)
    }
    state.set(id, 'done')
  }
  for (const id of ids) if (!state.has(id)) visit(id)

  const rank = new Map(ids.map((id) => [id, 0]))
  for (let changed = true; changed; ) {
    changed = false
    for (const [from, to] of forward)
      if (rank.get(to)! < rank.get(from)! + 1) {
        rank.set(to, rank.get(from)! + 1)
        changed = true
      }
  }
  const connected = new Set(graph.edges.flatMap((edge) => [edge.from, edge.to]))
  const order = (node: ArchitectureNode) => (connected.has(node.id) ? rank.get(node.id)! : Number.POSITIVE_INFINITY)
  const byOrder = (a: ArchitectureNode, b: ArchitectureNode) =>
    order(a) - order(b) || index.get(a.id)! - index.get(b.id)!

  const groups = new Map(graph.groups.map((group) => [group.id, group]))
  const blocks = new Map<string, OutlineSection>()
  for (const node of [...graph.nodes].sort(byOrder)) {
    const group = (node.groupId && groups.get(node.groupId)) || null
    const key = group ? `group:${group.id}` : `node:${node.id}`
    if (!blocks.has(key)) blocks.set(key, { group, nodes: [] })
    blocks.get(key)!.nodes.push(node)
  }
  const sections: OutlineSection[] = []
  for (const block of blocks.values()) {
    const last = sections.at(-1)
    if (!block.group && last && !last.group) last.nodes.push(...block.nodes)
    else sections.push(block)
  }
  return sections
}
