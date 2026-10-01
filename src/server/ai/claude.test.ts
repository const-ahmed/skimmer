import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AiError, createClaudeClient } from './claude'

const config = { accountId: 'acct', gatewayId: 'visualise', gatewayToken: 'gw-token' }

function streamOf(text: string, stopReason = 'end_turn'): Response {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 80 } }],
    ['message_stop', { type: 'message_stop' }],
  ]
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

describe('Claude client via AI Gateway', () => {
  it('sends one request to the gateway with the gateway token, no provider key, and the structured schema', async () => {
    const seen: Request[] = []
    const client = createClaudeClient(config, {
      fetch: async (input, init) => {
        seen.push(new Request(input, init))
        return streamOf('{"answer":"yes"}')
      },
    })
    const response = await client.structured({
      purpose: 'test',
      system: 'system',
      user: 'user',
      schema: z.object({ answer: z.string() }),
      maxTokens: 32_000,
      signal: new AbortController().signal,
    })
    expect(response).toMatchObject({ ok: true, value: { answer: 'yes' } })
    expect(response.call.usage).toMatchObject({ inputTokens: 1200, outputTokens: 80 })
    expect(seen).toHaveLength(1)
    const request = seen[0]!
    expect(request.url).toBe('https://gateway.ai.cloudflare.com/v1/acct/visualise/anthropic/v1/messages')
    expect(request.headers.get('cf-aig-authorization')).toBe('Bearer gw-token')
    expect(request.headers.has('x-api-key')).toBe(false)
    const body = (await request.json()) as {
      model: string
      stream: boolean
      output_config: { format: { type: string; schema: { properties: { answer: { type: string } } } } }
    }
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.stream).toBe(true)
    expect(body.output_config.format.type).toBe('json_schema')
    expect(body.output_config.format.schema.properties.answer.type).toBe('string')
  })

  it('reports schema mismatches and truncation instead of throwing', async () => {
    const schema = z.object({ answer: z.string() })
    const request = { purpose: 't', system: 's', user: 'u', schema, maxTokens: 100, signal: new AbortController().signal }
    const mismatch = createClaudeClient(config, { fetch: async () => streamOf('{"answer":1}') })
    expect(await mismatch.structured(request)).toMatchObject({ ok: false, failure: 'schema-mismatch' })
    const truncated = createClaudeClient(config, { fetch: async () => streamOf('{"ans', 'max_tokens') })
    expect(await truncated.structured(request)).toMatchObject({ ok: false, failure: 'truncated' })
  })

  it('maps provider failures to safe errors without retrying', async () => {
    let calls = 0
    const client = createClaudeClient(config, {
      fetch: async () => {
        calls++
        return new Response(JSON.stringify({ error: { message: 'secret account detail' } }), { status: 429 })
      },
    })
    const error = await client
      .structured({ purpose: 't', system: 's', user: 'u', schema: z.object({}), maxTokens: 10, signal: new AbortController().signal })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect((error as AiError).code).toBe('AI_RATE_LIMITED')
    expect((error as AiError).message).not.toContain('secret')
    expect(calls).toBe(1)
  })

  it('refuses to start without gateway configuration', () => {
    expect(() => createClaudeClient({ ...config, gatewayToken: '' })).toThrow(AiError)
  })
})

describe('structured output schema', () => {
  it('keeps enums enforced and drops keywords the API rejects', async () => {
    const { toStructuredSchema } = await import('./structured-schema')
    const { architectureWireSchema } = await import('@/server/architecture/schema')
    const { userFlowWireSchema } = await import('@/server/user-flow/schema')
    for (const schema of [architectureWireSchema, userFlowWireSchema]) {
      const json = JSON.stringify(toStructuredSchema(schema))
      for (const keyword of ['"minimum"', '"maximum"', '"minLength"', '"maxLength"', '"maxItems"', '"pattern"', '"$schema"'])
        expect(json, keyword).not.toContain(keyword)
      expect(json).toContain('"enum":[')
      expect(json).not.toMatch(/"type":\[/)
    }
    const json = toStructuredSchema(architectureWireSchema) as {
      properties: { nodes: { items: { properties: { kind: { enum: string[] } } } } }
    }
    expect(json.properties.nodes.items.properties.kind.enum).toContain('data-store')
  })
})
