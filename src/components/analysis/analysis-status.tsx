import { Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AnalysisProgress } from '@/server/analysis/result'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type View = 'architecture' | 'user-flows'
type StepState = 'done' | 'current' | 'pending'

const VIEW_LABELS: Record<View, string> = { architecture: 'Architecture', 'user-flows': 'User flows' }

// Every state comes from a progress event already received; nothing is estimated.
function stages(progress: AnalysisProgress[]): Array<{ label: string; state: StepState; note?: string }> {
  const seen = (stage: AnalysisProgress['stage']) => progress.some((item) => item.stage === stage)
  const analysing = progress.find((item) => item.stage === 'analysing')
  const views: View[] = analysing?.stage === 'analysing' ? analysing.views : ['architecture', 'user-flows']
  const complete = (view: View) => progress.some((item) => item.stage === 'view-complete' && item.view === view)
  const repairing = (view: View) => progress.some((item) => item.stage === 'repairing' && item.view === view)

  const list = [
    { label: 'Resolving the repository', done: seen('repository-resolved'), started: true },
    { label: 'Reading source', done: !!analysing, started: seen('reading-source') },
    ...views.map((view) => ({
      label: `Analysing ${VIEW_LABELS[view].toLowerCase()}`,
      done: complete(view),
      started: !!analysing,
      note: repairing(view) && !complete(view) ? 'Repairing output' : undefined,
    })),
  ]
  return list.map(({ label, done, started, ...rest }) => ({
    label,
    state: done ? 'done' : started ? 'current' : 'pending',
    ...rest,
  }))
}

function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!running) return
    const started = Date.now()
    setSeconds(0)
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [running])
  return seconds
}

function SkimIllustration() {
  return (
    <div aria-hidden className="relative h-14 w-12 overflow-hidden rounded-md border border-border-strong bg-surface p-2">
      <div className="space-y-1.5">
        {['w-full', 'w-3/4', 'w-5/6', 'w-1/2', 'w-2/3'].map((width, index) => (
          <div key={index} className={cn('h-[3px] rounded-full bg-border-strong', width)} />
        ))}
      </div>
      <div className="absolute inset-x-0 top-0 h-3 bg-brand/25 motion-safe:animate-skim motion-reduce:top-4" />
    </div>
  )
}

export function AnalysisStatus({
  running,
  progress,
  url,
}: {
  running: boolean
  progress: AnalysisProgress[]
  url: string
}) {
  const elapsed = useElapsedSeconds(running)
  const resolved = progress.find((item) => item.stage === 'repository-resolved')
  const identity =
    resolved?.stage === 'repository-resolved'
      ? `${resolved.repository.owner}/${resolved.repository.repo}`
      : url.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, '')

  return (
    <Dialog open={running}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="max-w-[calc(100%-2rem)] gap-5 bg-surface p-5 sm:max-w-md sm:p-6"
      >
        <DialogHeader className="flex-row items-center gap-4 text-left">
          <SkimIllustration />
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-lg">Analysing repository</DialogTitle>
            <DialogDescription className="truncate font-mono text-[13px] text-foreground">
              {identity}
              {resolved?.stage === 'repository-resolved' && (
                <span className="text-muted-foreground"> @ {resolved.repository.commitSha.slice(0, 7)}</span>
              )}
            </DialogDescription>
          </div>
        </DialogHeader>

        <ol className="space-y-2.5 border-t border-border pt-4" aria-live="polite">
          {stages(progress).map((step) => (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
                {step.state === 'done' ? (
                  <Check className="size-4 text-brand" />
                ) : step.state === 'current' ? (
                  <Loader2 className="size-4 text-brand motion-safe:animate-spin" />
                ) : (
                  <span className="size-1.5 rounded-full bg-border-strong" />
                )}
              </span>
              <span className={cn(step.state === 'pending' && 'text-muted-foreground', step.state === 'current' && 'font-medium')}>
                {step.label}
                <span className="sr-only">
                  {step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (in progress)' : ' (waiting)'}
                </span>
              </span>
              {step.note && <span className="text-xs text-muted-foreground">{step.note}</span>}
            </li>
          ))}
        </ol>

        <p className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span>Large repositories can take a minute or two.</span>
          <span className="tabular-nums">{elapsed} s</span>
        </p>
      </DialogContent>
    </Dialog>
  )
}
