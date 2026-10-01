// Hover is a neutral shift; keyboard focus is the accent ring, so the two never look alike.

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

export const interactiveCard = `transition-colors duration-150 motion-reduce:transition-none hover:border-foreground/35 hover:bg-surface-2 dark:hover:bg-border-strong/50 ${focusRing}`

export const interactiveText = `rounded-sm underline-offset-4 transition-colors duration-150 motion-reduce:transition-none hover:text-foreground hover:underline ${focusRing}`
