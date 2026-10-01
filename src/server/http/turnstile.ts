const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const PRODUCTION_HOSTNAMES = ['skimmer.dev']
const DEVELOPMENT_HOSTNAMES = ['skimmer.dev', 'localhost', '127.0.0.1']

export type TurnstileResult = { ok: true } | { ok: false; status: number; code: string; message: string }

const failed = (status: number, code: string, message: string): TurnstileResult => ({ ok: false, status, code, message })

export async function verifyTurnstile(params: {
  secret: string | undefined
  token: string
  remoteIp: string | null
}): Promise<TurnstileResult> {
  if (!params.secret) return failed(503, 'TURNSTILE_NOT_CONFIGURED', 'Verification is not available right now.')

  const form = new FormData()
  form.append('secret', params.secret)
  form.append('response', params.token)
  if (params.remoteIp) form.append('remoteip', params.remoteIp)

  let outcome: { success?: boolean; hostname?: string }
  try {
    const response = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`siteverify ${response.status}`)
    outcome = await response.json()
  } catch {
    return failed(503, 'TURNSTILE_UNAVAILABLE', 'Could not verify the request. Please try again.')
  }

  const hostnames = import.meta.env.DEV ? DEVELOPMENT_HOSTNAMES : PRODUCTION_HOSTNAMES
  if (outcome.success !== true || !outcome.hostname || !hostnames.includes(outcome.hostname))
    return failed(403, 'TURNSTILE_FAILED', 'Verification failed or expired. Please try again.')
  return { ok: true }
}
