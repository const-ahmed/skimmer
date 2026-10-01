import { ChevronDown, Download, FileJson } from 'lucide-react'
import type { AnalysisResult } from '@/server/analysis/result'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

function downloadJson(result: AnalysisResult) {
  const { owner, repo, commitSha } = result.repository
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `skimmer-${owner}-${repo}-${commitSha.slice(0, 7)}.json`,
  })
  link.click()
  URL.revokeObjectURL(url)
}

export function ExportMenu({ result, className }: { result: AnalysisResult; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label="Export"
          className={cn(
            'size-10 shrink-0 px-0 shadow-none xl:h-8 xl:w-auto xl:gap-1.5 xl:border xl:border-input xl:bg-surface xl:px-3',
            className,
          )}
        >
          <Download aria-hidden />
          <span className="hidden xl:inline">Export</span>
          <ChevronDown aria-hidden className="hidden size-3.5 text-muted-foreground xl:inline" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Export this analysis</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => downloadJson(result)} className="items-start gap-2.5 py-2">
          <FileJson aria-hidden className="mt-0.5" />
          <span>
            <span className="block font-medium">Analysis as JSON</span>
            <span className="block text-xs text-muted-foreground">Architecture, user flows and sources</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
