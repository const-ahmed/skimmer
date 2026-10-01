import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export type ResultView = 'architecture' | 'user-flows'

const VIEWS: Array<{ value: ResultView; label: string }> = [
  { value: 'architecture', label: 'Architecture' },
  { value: 'user-flows', label: 'User Flows' },
]

export function ViewSwitcher({
  value,
  onValueChange,
  className,
}: {
  value: ResultView
  onValueChange: (view: ResultView) => void
  className?: string
}) {
  const index = VIEWS.findIndex((view) => view.value === value)
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={value}
      // A single-select group would otherwise allow deselecting the active view.
      onValueChange={(next) => next && onValueChange(next as ResultView)}
      aria-label="Result view"
      className={cn('relative grid grid-cols-2 gap-0 rounded-full border border-border bg-surface-2 p-1', className)}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-brand transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {VIEWS.map((view) => (
        <ToggleGroupItem
          key={view.value}
          value={view.value}
          className={cn(
            'relative z-10 h-10 w-full rounded-full px-4 text-[13px] font-medium text-foreground/75 transition-colors duration-150 motion-reduce:transition-none md:h-7',
            'data-[state=off]:hover:bg-background/70 data-[state=off]:hover:text-foreground',
            'data-[state=on]:bg-transparent data-[state=on]:font-semibold data-[state=on]:text-brand-foreground data-[state=on]:hover:bg-transparent data-[state=on]:hover:text-brand-foreground',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2',
          )}
        >
          {view.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
