import type { RepositoryIdentity } from '@/server/repository/types'
import { cn } from '@/lib/utils'

export function RepositoryBreadcrumb({ repository, className }: { repository: RepositoryIdentity; className?: string }) {
  return (
    <nav aria-label="Repository" className={cn('flex min-w-0 items-baseline gap-2', className)}>
      <span className="min-w-0 truncate font-medium">
        <span className="text-muted-foreground">{repository.owner}</span>
        <span className="px-1 text-muted-foreground">/</span>
        {repository.repo}
      </span>
      <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
        {repository.defaultBranch}@{repository.commitSha.slice(0, 7)}
      </span>
    </nav>
  )
}
