import { Check, ChevronDown } from 'lucide-react'
import type { AnalysisProgress as Progress } from '@/server/analysis/result'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { focusRing } from '@/lib/interaction'
import { cn } from '@/lib/utils'

const VIEW_NAMES = { architecture: 'Architecture', 'user-flows': 'User Flows' } as const

function describe(progress: Progress): string {
  switch (progress.stage) {
    case 'resolving-repository':
      return 'Resolved the repository'
    case 'repository-resolved': {
      const { owner, repo, commitSha } = progress.repository
      return `Pinned ${owner}/${repo} at ${commitSha.slice(0, 7)}`
    }
    case 'reading-source':
      return 'Read source'
    case 'analysing':
      return `Analysed ${progress.views.map((view) => VIEW_NAMES[view]).join(' and ')}`
    case 'repairing':
      return `Repaired ${VIEW_NAMES[progress.view]} output`
    case 'view-complete':
      return `${VIEW_NAMES[progress.view]} complete`
  }
}

export function CompletedAnalysis({ progress, durationMs }: { progress: Progress[]; durationMs: number }) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'group -mx-2 inline-flex h-8 shrink-0 self-start items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:bg-surface-2 hover:text-foreground data-[state=open]:bg-surface-2 data-[state=open]:text-foreground motion-reduce:transition-none',
          focusRing,
        )}
      >
        <Check className="size-3.5 text-brand" aria-hidden />
        Analysed in {Math.round(durationMs / 1000)} s
        <ChevronDown
          aria-hidden
          className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Analysis steps</p>
        <ol className="space-y-1.5 text-[13px]">
          {progress.map((item, index) => (
            <li key={index} className="flex items-start gap-2">
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-brand" />
              {describe(item)}
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  )
}
