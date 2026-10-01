import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { CompletedAnalysis } from '@/components/analysis/analysis-progress'
import { AnalysisStatus, type Verification } from '@/components/analysis/analysis-status'
import { ArchitectureSummary } from '@/components/analysis/architecture-summary'
import { ArchitectureView } from '@/components/analysis/architecture-view'
import { useAnalysis } from '@/components/analysis/use-analysis'
import { UserFlowView } from '@/components/analysis/user-flow-view'
import { ViewMessage } from '@/components/analysis/view-message'
import { AppHeader } from '@/components/shell/app-header'
import { StartScreen } from '@/components/shell/start-screen'
import type { ResultView } from '@/components/shell/view-switcher'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [url, setUrl] = useState('')
  const [view, setView] = useState<ResultView>('architecture')
  const { state, start } = useAnalysis()
  const [verification, setVerification] = useState<Verification | null>(null)
  const attempts = useRef(0)
  const submitted = useRef('')
  const running = state.status === 'running'
  const busy = running || verification !== null
  const complete = state.status === 'complete' ? state : null
  const result = complete?.result ?? null

  useEffect(() => setView('architecture'), [result])

  const verify = () => setVerification({ attempt: ++attempts.current, error: null })
  const analyse = (next: string) => {
    submitted.current = next
    verify()
  }

  const status = (
    <AnalysisStatus
      running={running}
      progress={state.status === 'running' ? state.progress : []}
      url={url}
      verification={verification}
      onToken={(token) => {
        setVerification(null)
        void start(submitted.current, token)
      }}
      onVerificationError={(message) => setVerification((current) => current && { ...current, error: message })}
      onRetry={verify}
      onCancel={() => setVerification(null)}
    />
  )

  if (!complete || !result)
    return (
      <>
        <StartScreen
          url={url}
          onUrlChange={setUrl}
          onAnalyse={analyse}
          running={busy}
          error={state.status === 'error' ? state.message : null}
        />
        {status}
      </>
    )

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader
        repository={result.repository}
        view={view}
        onViewChange={setView}
        url={url}
        onUrlChange={setUrl}
        onAnalyse={analyse}
        running={busy}
        result={result}
      />

      <div className="flex flex-col gap-1 border-b border-border bg-surface px-4 py-2 md:flex-row md:items-start md:justify-between md:gap-6 md:px-6">
        {view === 'architecture' && result.architecture.status === 'complete' ? (
          <ArchitectureSummary summary={result.architecture.data.summary} />
        ) : (
          <span />
        )}
        <CompletedAnalysis progress={complete.progress} durationMs={result.diagnostics.durationMs} />
      </div>

      <main className="flex-1">
        {view === 'architecture' ? (
          result.architecture.status === 'complete' ? (
            <ArchitectureView architecture={result.architecture.data} />
          ) : (
            <div className="px-4 py-6 md:px-6">
              <ViewMessage tone="error" title="Architecture could not be analysed">
                {result.architecture.error.message}
              </ViewMessage>
            </div>
          )
        ) : (
          <div className="px-4 py-4 md:px-6 md:py-6">
            {result.userFlows.status === 'complete' ? (
              <UserFlowView userFlows={result.userFlows.data} repository={result.repository} />
            ) : (
              <ViewMessage tone="error" title="User flows could not be analysed">
                {result.userFlows.error.message}
              </ViewMessage>
            )}
            {import.meta.env.DEV && (
              <details className="mt-6">
                <summary className="text-xs text-muted-foreground">Raw result (development only)</summary>
                <pre className="mt-2 overflow-x-auto font-mono text-xs">{JSON.stringify(result, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
      </main>
      {status}
    </div>
  )
}
