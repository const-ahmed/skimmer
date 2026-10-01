import { SkimmerLogo } from '@/components/brand/skimmer-logo'
import { ThemeToggle } from '@/components/brand/theme-toggle'
import { ViewMessage } from '@/components/analysis/view-message'
import { RepositoryForm } from './repository-form'

export function StartScreen({
  url,
  onUrlChange,
  onAnalyse,
  running,
  error,
}: {
  url: string
  onUrlChange: (url: string) => void
  onAnalyse: (url: string) => void
  running: boolean
  error: string | null
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <div className="flex justify-end p-3">
        <ThemeToggle />
      </div>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 pb-[12svh]">
        <div className="space-y-3">
          <h1>
            <SkimmerLogo size="lg" />
          </h1>
          <p className="text-[15px]">See how a public GitHub repository is put together.</p>
        </div>
        <RepositoryForm autoFocus url={url} onUrlChange={onUrlChange} onSubmit={onAnalyse} running={running} />
        {error && <ViewMessage tone="error" title="Couldn’t analyse this repository">{error}</ViewMessage>}
      </main>
    </div>
  )
}
