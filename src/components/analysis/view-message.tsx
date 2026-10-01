import { CircleAlert, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ViewMessage({
  tone,
  title,
  children,
  className,
}: {
  tone: 'error' | 'empty'
  title: string
  children?: React.ReactNode
  className?: string
}) {
  const Icon = tone === 'error' ? CircleAlert : Info
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('mx-auto flex w-full max-w-xl gap-3 rounded-lg border border-border bg-surface p-4', className)}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')} />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{title}</p>
        {children && <div className="text-[13px] text-muted-foreground">{children}</div>}
      </div>
    </div>
  )
}
