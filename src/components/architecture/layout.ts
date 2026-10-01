import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import type { ArchitectureEdge, ArchitectureNode, ArchitectureResult } from '@/server/architecture/schema'

export type ComponentNodeData = { node: ArchitectureNode }
export type GroupNodeData = { label: string }
export type RoutedEdgeData = {
  points: Array<{ x: number; y: number }>
  label: { text: string; x: number; y: number; width: number; height: number } | null
  support: ArchitectureEdge['support']
}
export type ComponentFlowNode = Node<ComponentNodeData, 'component'>
export type GroupFlowNode = Node<GroupNodeData, 'group-frame'>
export type RoutedFlowEdge = Edge<RoutedEdgeData, 'routed'>

const NODE_HEIGHT = 48
// Approximate text widths for IBM Plex Sans at the sizes used on the canvas.
const nodeWidth = (label: string) => Math.min(240, Math.max(144, Math.round(label.length * 7.8 + 40)))
const edgeLabelSize = (text: string) => ({ width: Math.round(text.length * 5.7 + 10), height: 16 })
const groupLabelSize = (text: string) => ({ width: Math.round(text.length * 6.6 + 8), height: 16 })

export type GraphLayout = {
  nodes: Array<ComponentFlowNode | GroupFlowNode>
  edges: RoutedFlowEdge[]
  start: { x: number; y: number }
  bounds: { width: number; height: number }
}

let elk: { layout: (graph: ElkNode) => Promise<ElkNode> } | null = null

/**
 * Narrowness matters more than compactness: at most two nodes share a layer and
 * edges into the same node share a trunk, which roughly halves the width of
 * ELK's default top-to-bottom layering on large graphs.
 */
export async function layoutArchitecture(graph: ArchitectureResult['graph']): Promise<GraphLayout> {
  if (!elk) {
    // ELK is large; load it only when a diagram is drawn.
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
    elk = new ELK()
  }
  const sized = (node: ArchitectureNode): ElkNode => ({ id: node.id, width: nodeWidth(node.label), height: NODE_HEIGHT })
  const groups = graph.groups
    .map((group) => ({ group, members: graph.nodes.filter((node) => node.groupId === group.id) }))
    .filter(({ members }) => members.length)
  const grouped = new Set(groups.flatMap(({ members }) => members.map((node) => node.id)))

  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.edgeLabels.inline': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.layering.strategy': 'COFFMAN_GRAHAM',
      'elk.layered.layering.coffmanGraham.layerBound': '2',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.mergeEdges': 'true',
      'elk.spacing.nodeNode': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': '44',
      'elk.spacing.edgeNode': '12',
      'elk.spacing.edgeEdge': '8',
      'elk.spacing.edgeLabel': '4',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children: [
      ...groups.map(({ group, members }) => ({
        id: `group:${group.id}`,
        labels: [{ text: group.label, ...groupLabelSize(group.label) }],
        layoutOptions: {
          // Reserve the title inside the frame so no node or edge sits on it.
          'elk.nodeLabels.placement': 'INSIDE V_TOP H_LEFT',
          'elk.nodeSize.constraints': 'NODE_LABELS',
          'elk.padding': '[top=16,left=14,bottom=14,right=14]',
        },
        children: members.map(sized),
      })),
      ...graph.nodes.filter((node) => !grouped.has(node.id)).map(sized),
    ],
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
      labels: [{ text: edge.relationship, ...edgeLabelSize(edge.relationship) }],
    })),
  }
  const laidOut = await elk.layout(root)

  // ELK reports positions relative to each parent; React Flow children are
  // relative to their group, but edge geometry needs absolute coordinates.
  const absolute = new Map<string, { x: number; y: number }>([['root', { x: 0, y: 0 }]])
  const allEdges: ElkExtendedEdge[] = []
  const walk = (node: ElkNode, origin: { x: number; y: number }) => {
    allEdges.push(...(node.edges ?? []))
    for (const child of node.children ?? []) {
      const position = { x: origin.x + (child.x ?? 0), y: origin.y + (child.y ?? 0) }
      absolute.set(child.id, position)
      walk(child, position)
    }
  }
  walk(laidOut, { x: 0, y: 0 })

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const nodes: Array<ComponentFlowNode | GroupFlowNode> = []
  for (const child of laidOut.children ?? []) {
    if (!child.id.startsWith('group:')) continue
    nodes.push({
      id: child.id,
      type: 'group-frame',
      position: { x: child.x ?? 0, y: child.y ?? 0 },
      data: { label: child.labels?.[0]?.text ?? '' },
      width: child.width,
      height: child.height,
      style: { width: child.width, height: child.height },
      selectable: false,
      zIndex: -1,
    })
  }
  const place = (child: ElkNode, parentId?: string) => {
    const node = byId.get(child.id)
    if (!node) return
    nodes.push({
      id: node.id,
      type: 'component',
      position: { x: child.x ?? 0, y: child.y ?? 0 },
      data: { node },
      width: child.width,
      height: child.height,
      // React Flow disables pointer events on nodes that are neither selectable
      // nor draggable, which would make the node's own button unclickable.
      style: { pointerEvents: 'all' },
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
    })
  }
  // React Flow requires parents before their children.
  for (const child of laidOut.children ?? [])
    if (child.id.startsWith('group:')) for (const member of child.children ?? []) place(member, child.id)
    else place(child)

  const support = new Map(graph.edges.map((edge) => [edge.id, edge]))
  const edges: RoutedFlowEdge[] = allEdges.flatMap((routed) => {
    const edge = support.get(routed.id)
    const section = routed.sections?.[0]
    if (!edge || !section) return []
    const offset = absolute.get(routed.container ?? 'root') ?? { x: 0, y: 0 }
    const shift = (point: { x: number; y: number }) => ({ x: point.x + offset.x, y: point.y + offset.y })
    const label = routed.labels?.[0]
    return [
      {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'routed' as const,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--text-muted)' },
        data: {
          points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(shift),
          label: label
            ? { text: edge.relationship, ...shift({ x: label.x ?? 0, y: label.y ?? 0 }), width: label.width ?? 0, height: label.height ?? 0 }
            : null,
          support: edge.support,
        },
      },
    ]
  })
  const lead = (id: string) => absolute.get(id)?.y ?? 0
  const leads = graph.nodes.map((node) => lead(node.id))
  const first = Math.min(...leads)
  const span = Math.max(...leads) - first
  const degree = (id: string) => graph.edges.filter((edge) => edge.from === id || edge.to === id).length
  const [startNode] = graph.nodes
    .filter((node) => lead(node.id) <= first + span * 0.35)
    .sort((a, b) => degree(b.id) - degree(a.id) || lead(a.id) - lead(b.id))
  const startPosition = (startNode && absolute.get(startNode.id)) || { x: 0, y: 0 }
  const start = startNode
    ? { x: startPosition.x + nodeWidth(startNode.label) / 2, y: startPosition.y + NODE_HEIGHT / 2 }
    : startPosition
  const bounds = { width: laidOut.width ?? 0, height: laidOut.height ?? 0 }
  return { nodes, edges, start, bounds }
}
