import { z } from 'zod'
import { HTTP_LIMITS } from '@/server/analysis/limits'
import { MAX_REPOSITORY_INPUT_LENGTH } from '@/shared/github-url'

export const analyseRequestSchema = z.strictObject({
  repositoryUrl: z.string().trim().min(1).max(MAX_REPOSITORY_INPUT_LENGTH),
  // Turnstile tokens are at most 2048 characters. Optional here so a missing one gets its own error.
  turnstileToken: z.string().max(2048).optional(),
})

export type AnalyseRequest = z.infer<typeof analyseRequestSchema>

export type GuardResult =
  | { ok: true; body: AnalyseRequest }
  | { ok: false; status: number; code: string; message: string }

const reject = (status: number, code: string, message: string): GuardResult => ({
  ok: false,
  status,
  code,
  message,
})

/**
 * Browser same-origin check. Origin is sent by browsers on every POST, so a
 * missing or foreign Origin means the request did not come from this app.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(request.url).origin) return false
  const site = request.headers.get('sec-fetch-site')
  return site === null || site === 'same-origin'
}

export async function guardAnalyseRequest(request: Request): Promise<GuardResult> {
  if (!isSameOrigin(request)) return reject(403, 'FORBIDDEN_ORIGIN', 'Requests must come from this site.')
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return reject(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send a JSON body.')
  const text = await readBoundedText(request, HTTP_LIMITS.maxBodyBytes)
  if (text === null) return reject(413, 'BODY_TOO_LARGE', 'The request body is too large.')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return reject(400, 'INVALID_JSON', 'The request body is not valid JSON.')
  }
  const parsed = analyseRequestSchema.safeParse(json)
  if (!parsed.success)
    return reject(400, 'INVALID_REQUEST', 'Send {"repositoryUrl": "https://github.com/owner/repo"}.')
  return { ok: true, body: parsed.data }
}

async function readBoundedText(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const decoder = new TextDecoder()
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode()
}

/** Per-IP throttle for this Cloudflare location; approximate by design. */
export async function checkRateLimit(
  limiter: RateLimit | undefined,
  request: Request,
): Promise<boolean> {
  if (!limiter) return true
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const { success } = await limiter.limit({ key: `analyse:${ip}` })
  return success
}
