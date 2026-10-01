import { ArrowRight } from 'lucide-react'
import { useMemo } from 'react'
import type { ArchitectureNode, ArchitectureResult } from '@/server/architecture/schema'
import { readingOrder } from '@/components/architecture/reading-order'
import { interactiveCard } from '@/lib/interaction'
import { cn } from '@/lib/utils'

const EXTERNAL = new Set(['external-actor', 'external-service'])

export function ArchitectureOutline({
  graph,
  onSelect,
}: {
  graph: ArchitectureResult['graph']
  onSelect: (node: ArchitectureNode) => void
}) {
  const sections = useMemo(() => readingOrder(graph), [graph])
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph])

  return (
    <ol className="space-y-4">
      {sections.map((section) => (
        <li key={section.group?.id ?? `ungrouped:${section.nodes[0]!.id}`}>
          <section
            aria-label={section.group?.label ?? 'Components'}
            className={cn(section.group && 'rounded-lg border border-border-strong/70 bg-surface-2/60 p-2.5 dark:bg-surface/70')}
          >
            {section.group && (
              <h3 className="px-1 pb-2 text-xs font-semibold tracking-wide text-foreground/85 uppercase">
                {section.group.label}
              </h3>
            )}
            <ul className="space-y-2">
              {section.nodes.map((node) => {
                const outgoing = graph.edges.filter((edge) => edge.from === node.id && byId.has(edge.to))
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => onSelect(node)}
                      className={cn(
                        'block w-full rounded-md border border-border-strong bg-surface px-3.5 py-3 text-left dark:bg-surface-2',
                        interactiveCard,
                        EXTERNAL.has(node.kind) && 'border-dashed border-external/80 hover:border-external',
                      )}
                    >
                      <span className="flex items-center gap-2 text-[15px] leading-snug font-medium">
                        {node.kind === 'entry-point' && (
                          <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand" />
                        )}
                        {node.label}
                        {node.kind === 'entry-point' && <span className="sr-only"> (entry point)</span>}
                        {EXTERNAL.has(node.kind) && <span className="sr-only"> (outside the repository)</span>}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug">{node.summary}</span>
                      {outgoing.length > 0 && (
                        <span className="mt-2 block space-y-1 border-t border-border pt-2">
                          {outgoing.map((edge) => (
                            <span key={edge.id} className="flex items-start gap-1.5 text-[12.5px] leading-snug">
                              <ArrowRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                              <span>
                                <span className={cn('text-muted-foreground', edge.support === 'inferred' && 'italic')}>
                                  {edge.relationship}
                                </span>{' '}
                                <span className="font-medium">{byId.get(edge.to)!.label}</span>
                              </span>
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        </li>
      ))}
    </ol>
  )
}
