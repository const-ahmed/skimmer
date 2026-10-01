import { Network } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { ArchitectureNode, ArchitectureResult } from '@/server/architecture/schema'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useMediaQuery } from '@/hooks/use-media-query'
import { ArchitectureNodeDialog } from './architecture-node-dialog'
import { ArchitectureOutline } from './architecture-outline'

// Lazy: React Flow and ELK are large and phones may never open the diagram.
const ArchitectureGraph = lazy(() => import('@/components/architecture/architecture-graph'))

const loading = <p className="p-4 text-muted-foreground">Loading the diagram…</p>

export function ArchitectureView({ architecture }: { architecture: ArchitectureResult }) {
  const [selected, setSelected] = useState<ArchitectureNode | null>(null)
  const [diagramOpen, setDiagramOpen] = useState(false)
  const wide = useMediaQuery('(min-width: 768px)')
  const graph = architecture.graph

  return (
    <div className="px-4 py-4 md:px-6">
      {wide ? (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <Suspense fallback={loading}>
            <ArchitectureGraph graph={graph} mode="page" selectedId={selected?.id ?? null} onSelect={setSelected} />
          </Suspense>
        </div>
      ) : (
        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-2 bg-surface shadow-none"
            onClick={() => setDiagramOpen(true)}
          >
            <Network aria-hidden />
            View as diagram
          </Button>
          <ArchitectureOutline graph={graph} onSelect={setSelected} />
          <Dialog open={diagramOpen} onOpenChange={setDiagramOpen}>
            <DialogContent className="flex h-svh max-w-none flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none">
              <div className="border-b border-border bg-surface px-4 py-3 pr-12">
                <DialogTitle className="text-base">Architecture diagram</DialogTitle>
                <DialogDescription className="text-xs">Pinch to zoom, drag to move, tap a component.</DialogDescription>
              </div>
              <div className="min-h-0 flex-1">
                <Suspense fallback={loading}>
                  <ArchitectureGraph graph={graph} mode="fill" selectedId={selected?.id ?? null} onSelect={setSelected} />
                </Suspense>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
      <ArchitectureNodeDialog node={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  )
}
