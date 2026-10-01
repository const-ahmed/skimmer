import Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod'
import { MODEL_LIMITS } from '@/server/analysis/limits'
import { toStructuredSchema } from './structured-schema'

export interface GatewayConfig {
  accountId: string
  gatewayId: string
  /** AI Gateway token. The Anthropic key is stored in the gateway, not here. */
  gatewayToken: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  thinkingTokens: number
}

export interface ModelCall {
  purpose: string
  model: string
  durationMs: number
  stopReason: string | null
  usage: TokenUsage
}

export type ModelResponse<T> =
  | { ok: true; value: T; raw: string; call: ModelCall }
  | { ok: false; failure: 'invalid-json' | 'schema-mismatch' | 'truncated'; raw: string; call: ModelCall }

export type AiErrorCode = 'AI_RATE_LIMITED' | 'AI_TIMEOUT' | 'AI_UNAVAILABLE' | 'AI_REFUSED' | 'AI_MISCONFIGURED'

const AI_MESSAGES: Record<AiErrorCode, string> = {
  AI_RATE_LIMITED: 'The analysis service is busy. Please try again shortly.',
  AI_TIMEOUT: 'The analysis took too long. Please try again.',
  AI_UNAVAILABLE: 'The analysis service is temporarily unavailable.',
  AI_REFUSED: 'The model declined to analyse this content.',
  AI_MISCONFIGURED: 'The analysis service is not configured correctly.',
}

/** Carries only an application-authored message; provider details stay in logs. */
export class AiError extends Error {
  constructor(readonly code: AiErrorCode) {
    super(AI_MESSAGES[code])
    this.name = 'AiError'
  }
}

export interface StructuredRequest<T> {
  purpose: string
  system: string
  user: string
  schema: z.ZodType<T>
  maxTokens: number
  signal: AbortSignal
}

export interface ClaudeClient {
  structured<T>(request: StructuredRequest<T>): Promise<ModelResponse<T>>
}

export function createClaudeClient(
  config: GatewayConfig,
  options: { fetch?: typeof fetch } = {},
): ClaudeClient {
  if (!config.accountId || !config.gatewayId || !config.gatewayToken)
    throw new AiError('AI_MISCONFIGURED')
  const client = new Anthropic({
    apiKey: null,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(config.accountId)}/${encodeURIComponent(config.gatewayId)}/anthropic`,
    defaultHeaders: {
      'cf-aig-authorization': `Bearer ${config.gatewayToken}`,
      // Omitted on purpose: AI Gateway supplies the stored Anthropic key.
      'x-api-key': null,
    },
    // A slow but valid response must not be paid for twice.
    maxRetries: 0,
    timeout: MODEL_LIMITS.requestTimeoutMs,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })

  return {
    async structured(request) {
      const started = Date.now()
      let message: Anthropic.Message
      try {
        const stream = client.messages.stream(
          {
            model: MODEL_LIMITS.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
            thinking: { type: 'adaptive', display: 'omitted' },
            output_config: {
              effort: MODEL_LIMITS.effort,
              format: { type: 'json_schema', schema: toStructuredSchema(request.schema) },
            },
          },
          { signal: request.signal },
        )
        message = await stream.finalMessage()
      } catch (error) {
        request.signal.throwIfAborted()
        throw toAiError(error, request.purpose)
      }

      const call: ModelCall = {
        purpose: request.purpose,
        model: message.model,
        durationMs: Date.now() - started,
        stopReason: message.stop_reason,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
          thinkingTokens: message.usage.output_tokens_details?.thinking_tokens ?? 0,
        },
      }
      console.info(JSON.stringify({ event: 'ai.call', ...call }))
      if (message.stop_reason === 'refusal') throw new AiError('AI_REFUSED')

      const raw = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')
      if (message.stop_reason === 'max_tokens') return { ok: false, failure: 'truncated', raw, call }
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        return { ok: false, failure: 'invalid-json', raw, call }
      }
      const parsed = request.schema.safeParse(json)
      return parsed.success
        ? { ok: true, value: parsed.data, raw, call }
        : { ok: false, failure: 'schema-mismatch', raw, call }
    },
  }
}

function toAiError(error: unknown, purpose: string): AiError {
  const status = error instanceof Anthropic.APIError ? error.status : undefined
  console.error(
    JSON.stringify({
      event: 'ai.call_failed',
      purpose,
      status,
      type: error instanceof Error ? error.name : typeof error,
      requestId: error instanceof Anthropic.APIError ? error.requestID : undefined,
    }),
  )
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError('AI_TIMEOUT')
  if (status === 429 || status === 529) return new AiError('AI_RATE_LIMITED')
  if (status === 401 || status === 403 || status === 404) return new AiError('AI_MISCONFIGURED')
  return new AiError('AI_UNAVAILABLE')
}
