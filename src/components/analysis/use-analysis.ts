import { useCallback, useRef, useState } from 'react'
import type { AnalysisProgress, AnalysisResult } from '@/server/analysis/result'
import { readSse } from '@/shared/sse-client'

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'running'; progress: AnalysisProgress[] }
  | { status: 'complete'; progress: AnalysisProgress[]; result: AnalysisResult }
  | { status: 'error'; progress: AnalysisProgress[]; message: string }

/** Runs POST /api/analyse and follows its SSE stream. */
export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)

  const start = useCallback(async (repositoryUrl: string) => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const progress: AnalysisProgress[] = []
    setState({ status: 'running', progress })
    const fail = (message: string) => setState({ status: 'error', progress: [...progress], message })
    try {
      const response = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositoryUrl }),
        signal: abort.signal,
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
        return fail(body?.error?.message ?? `Request failed (${response.status})`)
      }
      for await (const message of readSse(response)) {
        if (message.event === 'progress') {
          progress.push(message.data as AnalysisProgress)
          setState({ status: 'running', progress: [...progress] })
        } else if (message.event === 'result') {
          setState({ status: 'complete', progress: [...progress], result: message.data as AnalysisResult })
        } else if (message.event === 'error') {
          fail((message.data as { message: string }).message)
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) fail(error instanceof Error ? error.message : String(error))
    }
  }, [])

  return { state, start }
}
