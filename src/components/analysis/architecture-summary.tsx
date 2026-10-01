import { useState } from 'react'
import { interactiveText } from '@/lib/interaction'
import { cn } from '@/lib/utils'

export function ArchitectureSummary({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="max-w-4xl py-1.5">
      <p className={expanded ? undefined : 'line-clamp-3 md:line-clamp-none'}>{summary}</p>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={cn('mt-1 h-8 text-xs font-medium underline md:hidden', interactiveText)}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}
