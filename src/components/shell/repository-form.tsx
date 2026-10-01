import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function RepositoryForm({
  url,
  onUrlChange,
  onSubmit,
  running,
  compact = false,
  autoFocus = false,
  className,
}: {
  url: string
  onUrlChange: (url: string) => void
  onSubmit: (url: string) => void
  running: boolean
  compact?: boolean
  autoFocus?: boolean
  className?: string
}) {
  return (
    <form
      className={cn('flex gap-2', className)}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(url)
      }}
    >
      <Input
        placeholder="https://github.com/owner/repo"
        value={url}
        onChange={(event) => onUrlChange(event.target.value)}
        aria-label="GitHub repository URL"
        required
        autoFocus={autoFocus}
        className={cn('font-mono text-[13px] shadow-none transition-colors hover:border-foreground/35', compact ? 'h-11 md:h-8' : 'h-11')}
      />
      <Button type="submit" disabled={running} className={cn('shadow-none', compact ? 'h-11 md:h-8' : 'h-11 px-5')}>
        {running ? 'Analysing…' : 'Analyse'}
      </Button>
    </form>
  )
}
