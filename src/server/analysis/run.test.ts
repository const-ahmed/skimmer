import { describe, expect, it } from 'vitest'
import type { AnalysisModel } from '@/server/ai'
import { AiError, type ModelCall, type ModelResponse } from '@/server/ai/claude'
import type { ArchitectureWire } from '@/server/architecture/schema'
import type { UserFlowWire } from '@/server/user-flow/schema'
import { COMMIT, fakeGitHub } from '@/test/fixtures'
import { analyseRepository } from './run'

const call = (purpose: string): ModelCall => ({
  purpose,
  model: 'claude-opus-5-5',
  durationMs: 1,
  stopReason: 'end_turn',
  usage: { inputTokens: 100, outputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, thinkingTokens: 0 },
})
const ok = <T>(purpose: string, value: T): ModelResponse<T> => ({ ok: true, value, raw: JSON.stringify(value), call: call(purpose) })

const WEB_APP = {
  'package.json': '{"dependencies":{"next":"15","react":"19"}}',
  'README.md': '# Profile builder\nBuild a profile.\n',
  'app/page.tsx': 'import { Form } from "../components/Form"\nexport default function Page() {\n  return <Form />\n}\n',
  'components/Form.tsx': 'export function Form() {\n  return <form onSubmit={save}><input required /><button>Save</button></form>\n}\n',
  'app/api/save/route.ts': 'export async function POST() {\n  return Response.json({ ok: true })\n}\n',
}

const LIBRARY = {
  'package.json': '{"name":"tiny"}',
  'src/index.ts': 'export function pad(value: string) {\n  return value.padStart(2)\n}\n',
}

const architecture = (path: string): ArchitectureWire => ({
  summary: 'A small product.',
  capabilities: ['Pad strings'],
  groups: [],
  nodes: [
    {
      id: 'entry',
      label: 'Entry',
      kind: 'entry-point',
      groupId: null,
      primaryPath: path,
      summary: 'Where requests start.',
      explanation: 'It receives input and returns output. It is the entry point of the library.',
      evidence: [{ path, startLine: 1, endLine: 2, symbol: null }],
    },
  ],
  edges: [],
  limitations: [],
})

const flows: UserFlowWire = {
  flows: [
    {
      id: 'save',
      title: 'Save details',
      actor: 'Visitor',
      entryRoute: '/',
      summary: null,
      steps: [
        { id: 'enter', label: 'Enter details', kind: 'input', explanation: null, evidence: [{ path: 'components/Form.tsx', startLine: 2, endLine: 2, symbol: null }] },
        { id: 'save', label: 'Save', kind: 'action', explanation: null, evidence: [{ path: 'components/Form.tsx', startLine: 2, endLine: 2, symbol: 'Form' }] },
      ],
    },
  ],
  noFlowsReason: null,
}

function scriptedModel(script: Partial<Record<keyof AnalysisModel, Array<() => ModelResponse<unknown>>>>) {
  const log: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const model = Object.fromEntries(
    (['analyseArchitecture', 'analyseUserFlows', 'repairArchitecture', 'repairUserFlows'] as const).map((name) => [
      name,
      async () => {
        log.push(name)
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
        const next = script[name]?.shift()
        if (!next) throw new Error(`unexpected ${name}`)
        return next()
      },
    ]),
  ) as unknown as AnalysisModel
  return { model, log, maxInFlight: () => maxInFlight }
}

const signal = () => new AbortController().signal

describe('analyseRepository', () => {
  it('makes exactly two parallel model calls for a web app and reads only at the resolved commit', async () => {
    const github = await fakeGitHub(WEB_APP)
    const scripted = scriptedModel({
      analyseArchitecture: [() => ok('architecture', architecture('app/page.tsx'))],
      analyseUserFlows: [() => ok('user-flows', flows)],
    })
    const progress: string[] = []
    const result = await analyseRepository('https://github.com/acme/app', { github, model: scripted.model }, {
      signal: signal(),
      onProgress: (event) => progress.push(event.stage),
    })
    expect(scripted.log.sort()).toEqual(['analyseArchitecture', 'analyseUserFlows'])
    expect(scripted.maxInFlight()).toBe(2)
    expect(result.diagnostics.modelCalls).toHaveLength(2)
    expect(result.repository).toMatchObject({ owner: 'acme', repo: 'app', defaultBranch: 'main', commitSha: COMMIT })
    const rawReads = github.requests.filter((request) => request.startsWith('raw/'))
    expect(rawReads.length).toBeGreaterThan(0)
    expect(rawReads.every((request) => request.startsWith(`raw/${COMMIT}/`))).toBe(true)
    expect(result.architecture.status).toBe('complete')
    expect(result.userFlows).toMatchObject({ status: 'complete', data: { status: 'flows' } })
    expect(progress[0]).toBe('resolving-repository')
    expect(result.coverage.architecture.shown.length).toBeGreaterThan(0)
  })

  it('makes one call for a repository without a user-facing surface', async () => {
    const github = await fakeGitHub(LIBRARY)
    const scripted = scriptedModel({ analyseArchitecture: [() => ok('architecture', architecture('src/index.ts'))] })
    const result = await analyseRepository('acme/app', { github, model: scripted.model }, { signal: signal() })
    expect(scripted.log).toEqual(['analyseArchitecture'])
    expect(result.userFlows).toMatchObject({ status: 'complete', data: { status: 'no-user-facing-surface', flows: [] } })
  })

  it('repairs only when validation needs it, with one narrow repair call', async () => {
    const github = await fakeGitHub(LIBRARY)
    const broken = architecture('src/index.ts')
    broken.nodes.push({ ...broken.nodes[0]!, label: 'Something else' })
    const scripted = scriptedModel({
      analyseArchitecture: [() => ok('architecture', broken)],
      repairArchitecture: [() => ok('architecture-repair', architecture('src/index.ts'))],
    })
    const result = await analyseRepository('acme/app', { github, model: scripted.model }, { signal: signal() })
    expect(scripted.log).toEqual(['analyseArchitecture', 'repairArchitecture'])
    expect(result.architecture.status).toBe('complete')
    expect(result.diagnostics.repairs.architecture.some((repair) => repair.kind === 'model-repair')).toBe(true)
  })

  it('does not call the model again for problems it can repair deterministically', async () => {
    const github = await fakeGitHub(LIBRARY)
    const output = architecture('./src/index.ts')
    output.nodes[0]!.evidence.push({ path: 'https://evil.example/x', startLine: 1, endLine: 1, symbol: null })
    output.nodes[0]!.evidence.push({ path: 'src/index.ts', startLine: 1, endLine: 99, symbol: null })
    const scripted = scriptedModel({ analyseArchitecture: [() => ok('architecture', output)] })
    const result = await analyseRepository('acme/app', { github, model: scripted.model }, { signal: signal() })
    expect(scripted.log).toEqual(['analyseArchitecture'])
    if (result.architecture.status !== 'complete') throw new Error('expected complete')
    expect(result.architecture.data.graph.nodes[0]!.evidence).toEqual([
      { path: 'src/index.ts', startLine: 1, endLine: 2, origin: 'model' },
    ])
  })

  it('contains invalid, truncated or failed model output to one view', async () => {
    const github = await fakeGitHub(WEB_APP)
    const scripted = scriptedModel({
      analyseArchitecture: [() => ({ ok: false, failure: 'truncated', raw: '{"summary":', call: call('architecture') })],
      analyseUserFlows: [() => ({ ok: false, failure: 'invalid-json', raw: 'not json', call: call('user-flows') })],
      repairUserFlows: [() => ({ ok: false, failure: 'invalid-json', raw: 'still not json', call: call('user-flow-repair') })],
    })
    const result = await analyseRepository('acme/app', { github, model: scripted.model }, { signal: signal() })
    expect(scripted.log.sort()).toEqual(['analyseArchitecture', 'analyseUserFlows', 'repairUserFlows'])
    expect(result.architecture).toMatchObject({ status: 'failed', error: { code: 'MODEL_OUTPUT_TRUNCATED' } })
    expect(result.userFlows).toMatchObject({ status: 'failed', error: { code: 'INVALID_MODEL_OUTPUT' } })

    const provider = scriptedModel({
      analyseArchitecture: [() => { throw new AiError('AI_RATE_LIMITED') }],
      analyseUserFlows: [() => ok('user-flows', flows)],
    })
    const partial = await analyseRepository('acme/app', { github: await fakeGitHub(WEB_APP), model: provider.model }, { signal: signal() })
    expect(partial.architecture).toMatchObject({ status: 'failed', error: { code: 'AI_RATE_LIMITED' } })
    expect(partial.userFlows.status).toBe('complete')
  })

  it('rejects malformed repository input before any network request', async () => {
    const github = await fakeGitHub(LIBRARY)
    const scripted = scriptedModel({})
    await expect(
      analyseRepository('https://evil.example/acme/app', { github, model: scripted.model }, { signal: signal() }),
    ).rejects.toMatchObject({ code: 'INVALID_REPOSITORY_URL' })
    expect(github.requests).toEqual([])
  })
})
