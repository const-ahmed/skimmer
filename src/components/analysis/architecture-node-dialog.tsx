import type { ArchitectureNode } from '@/server/architecture/schema'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SourceLink } from './source-link'

export function ArchitectureNodeDialog({
  node,
  onOpenChange,
}: {
  node: ArchitectureNode | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={node !== null} onOpenChange={onOpenChange}>
      {node && (
        <DialogContent className="bg-surface">
          <DialogHeader>
            <DialogTitle>{node.label}</DialogTitle>
            <DialogDescription className="text-[15px] leading-relaxed text-foreground">{node.explanation}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-start">
            {node.source ? (
              <SourceLink source={node.source} />
            ) : (
              <span className="text-sm text-muted-foreground">No source in this repository.</span>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
