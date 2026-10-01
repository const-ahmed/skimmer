import { ExternalLink } from 'lucide-react'
import type { SourceTarget } from '@/server/architecture/schema'
import type { Evidence } from '@/server/evidence/schema'
import type { RepositoryIdentity } from '@/server/repository/types'
import { githubBlobUrl } from '@/shared/evidence-links'
import { interactiveText } from '@/lib/interaction'
import { cn } from '@/lib/utils'

const pathLinkClass = cn('inline font-mono text-[12.5px] [overflow-wrap:anywhere]', interactiveText)

function lines(startLine?: number, endLine?: number): string {
  if (startLine === undefined) return ''
  return endLine === undefined || endLine === startLine ? `#L${startLine}` : `#L${startLine}-L${endLine}`
}

export function SourceLink({ source, className }: { source: SourceTarget; className?: string }) {
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className={cn(pathLinkClass, className)}>
      {source.path}
      {source.type === 'directory' ? '/' : lines(source.startLine, source.endLine)}
      <ExternalLink className="ml-1 inline size-3.5 align-[-2px]" aria-hidden />
    </a>
  )
}

function lineLabel(startLine?: number, endLine?: number): string | null {
  if (startLine === undefined) return null
  return endLine === undefined || endLine === startLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`
}

export function EvidenceLink({
  evidence,
  repository,
  className,
}: {
  evidence: Evidence
  repository: RepositoryIdentity
  className?: string
}) {
  const name = evidence.path.slice(evidence.path.lastIndexOf('/') + 1)
  const range = lineLabel(evidence.startLine, evidence.endLine)
  return (
    <a
      href={githubBlobUrl({ ...repository, ...evidence })}
      target="_blank"
      rel="noreferrer"
      title={evidence.path}
      className={cn('inline-flex max-w-full items-center gap-1 text-muted-foreground', interactiveText, className)}
    >
      <span className="truncate">{name}</span>
      {range && <span className="shrink-0 text-muted-foreground/80">{range}</span>}
      <ExternalLink aria-hidden className="size-3 shrink-0" />
    </a>
  )
}
