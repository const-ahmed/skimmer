import { Search, X } from 'lucide-react'
import { useState } from 'react'
import type { AnalysisResult } from '@/server/analysis/result'
import type { RepositoryIdentity } from '@/server/repository/types'
import { SkimmerLogo } from '@/components/brand/skimmer-logo'
import { ThemeToggle } from '@/components/brand/theme-toggle'
import { Button } from '@/components/ui/button'
import { ExportMenu } from './export-menu'
import { RepositoryBreadcrumb } from './repository-breadcrumb'
import { RepositoryForm } from './repository-form'
import { ViewSwitcher, type ResultView } from './view-switcher'

export function AppHeader({
  repository,
  view,
  onViewChange,
  url,
  onUrlChange,
  onAnalyse,
  running,
  result,
}: {
  repository: RepositoryIdentity
  view: ResultView
  onViewChange: (view: ResultView) => void
  url: string
  onUrlChange: (url: string) => void
  onAnalyse: (url: string) => void
  running: boolean
  result: AnalysisResult
}) {
  const [formOpen, setFormOpen] = useState(false)
  return (
    <header className="border-b border-border bg-surface">
      <div className="flex h-14 items-center gap-2 px-4 sm:gap-3 md:px-6">
        <h1 className="shrink-0">
          <SkimmerLogo wordmark={false} className="sm:hidden" />
          <SkimmerLogo className="hidden sm:inline-flex" />
        </h1>
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        <RepositoryBreadcrumb repository={repository} className="flex-1" />
        <ViewSwitcher value={view} onValueChange={onViewChange} className="hidden w-60 shrink-0 md:grid" />
        <RepositoryForm
          compact
          url={url}
          onUrlChange={onUrlChange}
          onSubmit={onAnalyse}
          running={running}
          className="hidden w-80 shrink-0 xl:flex"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 shadow-none xl:hidden"
          aria-label={formOpen ? 'Close repository form' : 'Analyse another repository'}
          aria-expanded={formOpen}
          aria-controls="header-repository-form"
          onClick={() => setFormOpen((open) => !open)}
        >
          {formOpen ? <X aria-hidden /> : <Search aria-hidden />}
        </Button>
        <ExportMenu result={result} />
        <ThemeToggle />
      </div>
      {formOpen && (
        <div id="header-repository-form" className="border-t border-border px-4 py-3 md:px-6 xl:hidden">
          <RepositoryForm autoFocus compact url={url} onUrlChange={onUrlChange} onSubmit={onAnalyse} running={running} />
        </div>
      )}
      <div className="px-4 pb-3 md:hidden">
        <ViewSwitcher value={view} onValueChange={onViewChange} className="w-full" />
      </div>
    </header>
  )
}
