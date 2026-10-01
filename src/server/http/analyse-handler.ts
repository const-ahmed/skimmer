import { createAnalysisModel } from '@/server/ai'
import { createClaudeClient } from '@/server/ai/claude'
import { toPublicError } from '@/server/analysis/errors'
import { HTTP_LIMITS } from '@/server/analysis/limits'
import { analyseRepository } from '@/server/analysis/run'
import { createGitHubClient } from '@/server/github/client'
import { checkRateLimit, guardAnalyseRequest } from './guard'
import { createSseResponse } from './sse'

export interface AnalyseEnv {
  ANALYSIS_RATE_LIMITER?: RateLimit
  GITHUB_API_TOKEN?: string
  CF_AIG_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  AI_GATEWAY_ID?: string
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * POST /api/analyse. Guards run before any GitHub or model work. The response
 * is an SSE stream of `progress` events ending in one `result` or `error`.
 */
export async function handleAnalyseRequest(request: Request, env: AnalyseEnv): Promise<Response> {
  const guard = await guardAnalyseRequest(request)
  if (!guard.ok) return jsonError(guard.status, guard.code, guard.message)
  if (!(await checkRateLimit(env.ANALYSIS_RATE_LIMITER, request)))
    return jsonError(429, 'RATE_LIMITED', 'Too many analyses from this address. Please wait a minute.')

  let model
  try {
    model = createAnalysisModel(
      createClaudeClient({
        accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
        gatewayId: env.AI_GATEWAY_ID ?? '',
        gatewayToken: env.CF_AIG_TOKEN ?? '',
      }),
    )
  } catch (error) {
    const publicError = toPublicError(error)
    return jsonError(503, publicError.code, publicError.message)
  }

  const cancelled = new AbortController()
  const signal = AbortSignal.any([
    cancelled.signal,
    request.signal,
    AbortSignal.timeout(HTTP_LIMITS.analysisDeadlineMs),
  ])
  const { response, channel } = createSseResponse(() => cancelled.abort())
  const github = createGitHubClient({ token: env.GITHUB_API_TOKEN, signal })

  void analyseRepository(guard.body.repositoryUrl, { github, model }, {
    signal,
    onProgress: (progress) => channel.send('progress', progress),
  })
    .then((result) => channel.send('result', result))
    .catch((error: unknown) => {
      if (cancelled.signal.aborted || request.signal.aborted) return
      const { code, message } = toPublicError(error)
      channel.send('error', { code, message })
    })
    .finally(() => channel.close())

  return response
}
