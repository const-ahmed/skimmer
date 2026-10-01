import { cn } from '@/lib/utils'

const SIZES = {
  md: { mark: 'size-9', gap: 'gap-2.5', wordmark: 'text-lg' },
  lg: { mark: 'size-12', gap: 'gap-3', wordmark: 'text-2xl' },
}

// Both marks are rendered and CSS shows one, so the right mark appears before hydration.
export function SkimmerLogo({
  wordmark = true,
  size = 'md',
  className,
}: {
  wordmark?: boolean
  size?: keyof typeof SIZES
  className?: string
}) {
  const sizing = SIZES[size]
  return (
    <span className={cn('inline-flex items-center', sizing.gap, className)}>
      <img src="/brand/skimmer-mark-dark.png" alt="" aria-hidden className={cn(sizing.mark, 'dark:hidden')} />
      <img src="/brand/skimmer-mark-light.png" alt="" aria-hidden className={cn(sizing.mark, 'hidden dark:block')} />
      {wordmark ? (
        <span className={cn('font-serif leading-none font-bold tracking-[0.06em]', sizing.wordmark)}>SKIMMER</span>
      ) : (
        <span className="sr-only">Skimmer</span>
      )}
    </span>
  )
}
