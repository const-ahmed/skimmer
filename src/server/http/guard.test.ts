import { describe, expect, it } from 'vitest'
import { checkRateLimit, guardAnalyseRequest } from './guard'

const ORIGIN = 'https://visualise.example'

function request(body: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/analyse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...headers },
    body,
  })
}

describe('analysis request guard', () => {
  it('accepts a same-origin JSON request', async () => {
    const result = await guardAnalyseRequest(request('{"repositoryUrl":"acme/app"}'))
    expect(result).toEqual({ ok: true, body: { repositoryUrl: 'acme/app' } })
  })

  it.each([
    [{ origin: 'https://evil.example' }, 403],
    [{ origin: '' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403],
    [{ 'content-type': 'text/plain' }, 415],
  ])('rejects %o with %s', async (headers, status) => {
    const result = await guardAnalyseRequest(request('{"repositoryUrl":"acme/app"}', headers))
    expect(result).toMatchObject({ ok: false, status })
  })

  it('rejects oversized, malformed and unexpected bodies', async () => {
    expect(await guardAnalyseRequest(request(JSON.stringify({ repositoryUrl: 'x'.repeat(5_000) })))).toMatchObject({ status: 413 })
    expect(await guardAnalyseRequest(request('{'))).toMatchObject({ status: 400 })
    expect(await guardAnalyseRequest(request('{"repositoryUrl":"acme/app","extra":1}'))).toMatchObject({ status: 400 })
    expect(await guardAnalyseRequest(request('{"repositoryUrl":42}'))).toMatchObject({ status: 400 })
  })

  it('throttles by client IP', async () => {
    const keys: string[] = []
    const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: keys.length < 2 }) }
    const req = request('{}', { 'cf-connecting-ip': '203.0.113.9' })
    expect(await checkRateLimit(limiter, req)).toBe(true)
    expect(await checkRateLimit(limiter, req)).toBe(false)
    expect(keys).toEqual(['analyse:203.0.113.9', 'analyse:203.0.113.9'])
  })
})
