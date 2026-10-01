import { AiError } from '@/server/ai/claude'
import { GitHubError } from '@/server/github/errors'

export type AnalysisErrorCode = 'INVALID_REPOSITORY_URL' | 'ANALYSIS_TIMEOUT' | 'INTERNAL_ERROR'

export class AnalysisError extends Error {
  constructor(
    readonly code: AnalysisErrorCode,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message)
    this.name = 'AnalysisError'
  }
}

/** The only error shape that reaches a client. */
export interface PublicError {
  code: string
  message: string
  httpStatus: number
}

export function toPublicError(error: unknown): PublicError {
  if (error instanceof AnalysisError || error instanceof GitHubError)
    return { code: error.code, message: error.message, httpStatus: error.httpStatus }
  if (error instanceof AiError)
    return { code: error.code, message: error.message, httpStatus: error.code === 'AI_RATE_LIMITED' ? 429 : 502 }
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return { code: 'ANALYSIS_TIMEOUT', message: 'The analysis took too long.', httpStatus: 504 }
  console.error(
    JSON.stringify({
      event: 'analysis.unexpected_error',
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message.slice(0, 300) : undefined,
    }),
  )
  return { code: 'INTERNAL_ERROR', message: 'The analysis failed unexpectedly.', httpStatus: 500 }
}
