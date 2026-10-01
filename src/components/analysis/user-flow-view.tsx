import {
  Eye,
  Flag,
  MessageSquareText,
  MousePointerClick,
  Navigation,
  TextCursorInput,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { RepositoryIdentity } from '@/server/repository/types'
import type { UserFlow, UserFlowResult, UserFlowStep } from '@/server/user-flow/schema'
import { cn } from '@/lib/utils'
import { EvidenceLink } from './source-link'
import { ViewMessage } from './view-message'

const KINDS: Record<UserFlowStep['kind'], { label: string; icon: LucideIcon }> = {
  navigate: { label: 'Navigate', icon: Navigation },
  view: { label: 'View', icon: Eye },
  input: { label: 'Input', icon: TextCursorInput },
  action: { label: 'Action', icon: MousePointerClick },
  feedback: { label: 'Feedback', icon: MessageSquareText },
  result: { label: 'Result', icon: Flag },
}

function Step({
  step,
  number,
  last,
  repository,
}: {
  step: UserFlowStep
  number: number
  last: boolean
  repository: RepositoryIdentity
}) {
  const kind = KINDS[step.kind]
  const outcome = step.kind === 'result'
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!last && <span aria-hidden className="absolute top-8 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border-strong" />}
      <span
        aria-hidden
        className={cn(
          'relative z-10 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-xs font-semibold tabular-nums',
          outcome && 'border-brand/50 bg-brand-soft text-brand',
        )}
      >
        {number}
      </span>
      <div
        className={cn(
          'min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2.5 sm:px-3.5 dark:bg-surface-2/50',
          outcome && 'border-brand/35',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[14.5px] leading-snug font-medium">
            <span className="sr-only">Step {number}: </span>
            {step.label}
          </p>
          <span
            className={cn(
              'mt-0.5 flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground',
              outcome && 'text-brand',
            )}
          >
            <kind.icon aria-hidden className="size-3.5" />
            <span className="sr-only sm:not-sr-only">{kind.label}</span>
          </span>
        </div>
        {step.explanation && (
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{step.explanation}</p>
        )}
        {step.evidence.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span className="sr-only">Sources:</span>
            {step.evidence.map((evidence) => (
              <EvidenceLink
                key={`${evidence.path}:${evidence.startLine}-${evidence.endLine}`}
                evidence={evidence}
                repository={repository}
              />
            ))}
          </p>
        )}
      </div>
    </li>
  )
}

function Journey({ flow, repository }: { flow: UserFlow; repository: RepositoryIdentity }) {
  return (
    <article className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="space-y-1.5 border-b border-border px-4 py-3.5 md:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base leading-snug font-semibold">{flow.title}</h3>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{flow.steps.length} steps</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <UserRound aria-hidden className="size-3.5" />
            {flow.actor}
          </span>
          {flow.entryRoute && (
            <span className="min-w-0 [overflow-wrap:anywhere]">
              starts at{' '}
              <code className="rounded-sm bg-surface-2 px-1 py-px font-mono text-[11.5px] text-foreground">
                {flow.entryRoute}
              </code>
            </span>
          )}
        </div>
        {flow.summary && <p className="text-[13.5px] leading-snug">{flow.summary}</p>}
      </header>
      <ol className="px-3 py-4 sm:px-4 md:px-5" aria-label={`Steps of ${flow.title}`}>
        {flow.steps.map((step, index) => (
          <Step
            key={step.id}
            step={step}
            number={index + 1}
            last={index === flow.steps.length - 1}
            repository={repository}
          />
        ))}
      </ol>
    </article>
  )
}

export function UserFlowView({ userFlows, repository }: { userFlows: UserFlowResult; repository: RepositoryIdentity }) {
  if (!userFlows.flows.length)
    return (
      <ViewMessage tone="empty" title="No user flows found">
        {userFlows.reason}
      </ViewMessage>
    )

  const caption = (
    <p className="col-span-full text-xs text-muted-foreground">
      {userFlows.flows.length} {userFlows.flows.length === 1 ? 'flow' : 'flows'}, most important first
    </p>
  )

  // Not a grid: the caption spans every track, so a lone card could not be centred.
  if (userFlows.flows.length === 1)
    return (
      <div className="mx-auto w-full max-w-[42rem] space-y-5">
        {caption}
        <Journey flow={userFlows.flows[0]!} repository={repository} />
      </div>
    )

  return (
    // auto-fit sizes tracks by their maximum, so a second column appears only at full width.
    <div className="mx-auto grid w-full max-w-[94rem] grid-cols-[repeat(auto-fit,minmax(min(100%,40rem),42rem))] items-start justify-center gap-5">
      {caption}
      {userFlows.flows.map((flow) => (
        <Journey key={flow.id} flow={flow} repository={repository} />
      ))}
    </div>
  )
}
