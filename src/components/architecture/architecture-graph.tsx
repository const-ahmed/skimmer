import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ControlButton,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  type EdgeProps,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { CircleHelp } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ArchitectureNode, ArchitectureResult } from '@/server/architecture/schema'
import { ViewMessage } from '@/components/analysis/view-message'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMediaQuery } from '@/hooks/use-media-query'
import { interactiveCard } from '@/lib/interaction'
import { cn } from '@/lib/utils'
import {
  layoutArchitecture,
  type ComponentFlowNode,
  type GraphLayout,
  type GroupFlowNode,
  type RoutedFlowEdge,
} from './layout'

interface Selection {
  selectedId: string | null
  onSelect: (node: ArchitectureNode) => void
}
const SelectionContext = createContext<Selection>({ selectedId: null, onSelect: () => {} })

const EXTERNAL_KINDS: ReadonlySet<string> = new Set(['external-actor', 'external-service'])

function ComponentNode({ data }: NodeProps<ComponentFlowNode>) {
  const { selectedId, onSelect } = useContext(SelectionContext)
  const { node } = data
  const selected = selectedId === node.id
  return (
    <>
      <Handle type="target" position={Position.Top} className="pointer-events-none! opacity-0!" />
      <button
        type="button"
        title={node.summary}
        aria-haspopup="dialog"
        onClick={() => onSelect(node)}
        className={cn(
          'flex size-full items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-center text-[13.5px] leading-tight font-medium text-foreground dark:bg-surface-2',
          interactiveCard,
          EXTERNAL_KINDS.has(node.kind) && 'border-dashed border-external/80 hover:border-external',
          selected && 'border-brand bg-brand-soft hover:border-brand hover:bg-brand-soft dark:bg-brand-soft dark:hover:bg-brand-soft',
        )}
      >
        {node.kind === 'entry-point' && <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand" />}
        <span className="line-clamp-2">
          {node.label}
          {node.kind === 'entry-point' && <span className="sr-only"> (entry point)</span>}
          {EXTERNAL_KINDS.has(node.kind) && <span className="sr-only"> (outside the repository)</span>}
        </span>
      </button>
      <Handle type="source" position={Position.Bottom} className="pointer-events-none! opacity-0!" />
    </>
  )
}

function GroupFrame({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div className="size-full rounded-lg border border-border-strong/70 bg-surface-2/60 dark:bg-surface/70">
      <div className="px-3.5 pt-2.5 text-xs leading-4 font-semibold tracking-wide text-foreground/85 uppercase">
        {data.label}
      </div>
    </div>
  )
}

function roundedPath(points: Array<{ x: number; y: number }>, radius = 6): string {
  if (points.length < 2) return ''
  let path = `M ${points[0]!.x} ${points[0]!.y}`
  for (let index = 1; index < points.length - 1; index++) {
    const [previous, corner, next] = [points[index - 1]!, points[index]!, points[index + 1]!]
    const into = Math.min(radius, Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2)
    const out = Math.min(radius, Math.hypot(next.x - corner.x, next.y - corner.y) / 2)
    const toward = (from: typeof corner, to: typeof corner, distance: number) => {
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
      return { x: from.x + ((to.x - from.x) / length) * distance, y: from.y + ((to.y - from.y) / length) * distance }
    }
    const start = toward(corner, previous, into)
    const end = toward(corner, next, out)
    path += ` L ${start.x} ${start.y} Q ${corner.x} ${corner.y} ${end.x} ${end.y}`
  }
  const last = points[points.length - 1]!
  return `${path} L ${last.x} ${last.y}`
}

function RoutedEdge({ id, data, markerEnd }: EdgeProps<RoutedFlowEdge>) {
  if (!data) return null
  return (
    <>
      <BaseEdge
        id={id}
        path={roundedPath(data.points)}
        markerEnd={markerEnd}
        style={data.support === 'inferred' ? { strokeDasharray: '4 4' } : undefined}
      />
      {data.label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute flex items-center justify-center rounded-sm bg-background px-1 text-[10.5px] leading-none whitespace-nowrap text-muted-foreground"
            style={{
              transform: `translate(${data.label.x}px, ${data.label.y}px)`,
              width: data.label.width,
              height: data.label.height,
            }}
          >
            {data.label.text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

function DiagramHelp() {
  const key = [
    { swatch: <span className="size-2 rounded-full bg-brand" />, text: 'Entry point' },
    {
      swatch: <span className="h-3 w-5 rounded-[3px] border border-dashed border-external/80" />,
      text: 'Outside the repository',
    },
    { swatch: <span className="w-5 border-t border-dashed border-muted-foreground" />, text: 'Relationship inferred, not cited' },
  ]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ControlButton title="How to read this diagram" aria-label="How to read this diagram" className="[&_svg]:fill-none!">
          <CircleHelp />
        </ControlButton>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-64 p-3 text-[13px]">
        <ul className="space-y-2">
          {key.map(({ swatch, text }) => (
            <li key={text} className="flex items-center gap-2.5">
              <span aria-hidden className="flex w-5 justify-center">
                {swatch}
              </span>
              {text}
            </li>
          ))}
        </ul>
        <p className="mt-2.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
          Select a component for its explanation and source.
        </p>
      </PopoverContent>
    </Popover>
  )
}

const nodeTypes = { component: ComponentNode, 'group-frame': GroupFrame }
const edgeTypes = { routed: RoutedEdge }

type Instance = ReactFlowInstance<ComponentFlowNode | GroupFlowNode, RoutedFlowEdge>

const MIN_PAGE_ZOOM = 0.6

/**
 * "page": as tall as the diagram at a readable zoom, so the page scroll reads it.
 * "fill": fits the whole diagram into its container.
 */
export default function ArchitectureGraph({
  graph,
  mode,
  selectedId,
  onSelect,
}: {
  graph: ArchitectureResult['graph']
  mode: 'page' | 'fill'
  selectedId: string | null
  onSelect: (node: ArchitectureNode) => void
}) {
  const [layout, setLayout] = useState<GraphLayout | null>(null)
  const [failed, setFailed] = useState(false)
  const [width, setWidth] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const instance = useRef<Instance | null>(null)
  const coarse = useMediaQuery('(pointer: coarse)')

  useEffect(() => {
    let current = true
    setLayout(null)
    layoutArchitecture(graph).then(
      (result) => current && setLayout(result),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [graph])

  const measured = useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // A diagram too wide even at the minimum zoom is anchored on where reading starts.
  const page = useMemo(() => {
    if (!layout || !width) return null
    const { bounds, start } = layout
    const zoom = Math.min(1, Math.max(MIN_PAGE_ZOOM, width / bounds.width))
    const spare = width - bounds.width * zoom
    const x = spare >= 0 ? spare / 2 : Math.min(0, Math.max(spare, width / 2 - start.x * zoom))
    return { viewport: { x, y: 0, zoom } satisfies Viewport, height: Math.ceil(bounds.height * zoom) }
  }, [layout, width])

  useEffect(() => {
    if (mode === 'page' && page) void instance.current?.setViewport(page.viewport)
  }, [mode, page])

  if (failed)
    return (
      <ViewMessage tone="error" title="The diagram could not be drawn" className="my-6">
        Reload the page to try again.
      </ViewMessage>
    )

  // Touch screens scroll the page through the canvas until the reader zooms in.
  const scrollThrough = mode === 'page' && coarse && !zoomed
  const ready = layout && (mode === 'fill' || page)
  return (
    <div
      ref={measured}
      data-scroll-through={scrollThrough || undefined}
      className={cn('relative w-full', mode === 'fill' && 'h-full')}
      style={mode === 'page' ? { height: page?.height ?? 320 } : undefined}
    >
      {!ready ? (
        <p className="p-4 text-muted-foreground">Laying out the diagram…</p>
      ) : (
        <SelectionContext.Provider value={{ selectedId, onSelect }}>
          <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(flow) => {
              instance.current = flow
              if (mode === 'page' && page) void flow.setViewport(page.viewport)
              else void flow.fitView({ padding: 0.04 })
            }}
            onMoveEnd={(_, viewport) => page && setZoomed(Math.abs(viewport.zoom - page.viewport.zoom) > 0.01)}
            minZoom={0.15}
            maxZoom={2}
            zoomOnScroll={mode === 'fill'}
            preventScrolling={mode === 'fill'}
            panOnDrag={!scrollThrough}
            zoomOnPinch={!scrollThrough}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            zoomOnDoubleClick={false}
            aria-label="Architecture diagram"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
            <Controls showInteractive={false} position="top-right" fitViewOptions={{ padding: 0.04 }}>
              <DiagramHelp />
            </Controls>
          </ReactFlow>
        </SelectionContext.Provider>
      )}
    </div>
  )
}
