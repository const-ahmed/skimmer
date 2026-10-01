import { describe, expect, it } from 'vitest'
import type { EvidenceScope } from '@/server/evidence/scope'
import type { ArchitectureWire } from './schema'
import type { TreeEntry } from '@/server/repository/types'
import { ownerOf } from './ownership'
import { finaliseArchitecture, staticEvidenceFor } from './validate'

const handlerLines = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`)
const scope: EvidenceScope = {
  commitSha: 'c'.repeat(40),
  files: new Map([
    ['src/api/handler.ts', { path: 'src/api/handler.ts', lineCount: 60, ranges: [{ start: 1, end: 30 }], lines: handlerLines, kind: 'source' as const }],
    ['README.md', { path: 'README.md', lineCount: 10, ranges: [{ start: 1, end: 10 }], lines: Array(10).fill('docs'), kind: 'readme' as const }],
  ]),
  repositoryPaths: new Set(['src/api/handler.ts', 'src/db/store.ts', 'src/limits/limiter.ts', 'README.md', 'src', 'src/api', 'src/db']),
}
const references = [{ fromPath: 'src/api/handler.ts', toPath: 'src/db/store.ts', line: 3 }]
const extra = {
  repository: { owner: 'acme', repo: 'app', commitSha: 'c'.repeat(40) },
  entries: new Map<string, TreeEntry>(
    [...scope.repositoryPaths].map((path) => [
      path,
      path.includes('.') ? { path, type: 'blob', sha: 'a'.repeat(40), size: 10 } : { path, type: 'tree', sha: 'a'.repeat(40) },
    ]),
  ),
}

const ev = (path: string, startLine: number, endLine: number) => ({ path, startLine, endLine, symbol: null })

function node(id: string, overrides: Partial<ArchitectureWire['nodes'][number]> = {}): ArchitectureWire['nodes'][number] {
  return {
    id,
    label: id.replace(/-/g, ' '),
    kind: 'service',
    groupId: null,
    primaryPath: null,
    summary: `${id} summary.`,
    explanation: `${id} explanation.`,
    evidence: [],
    ...overrides,
  }
}

function wire(overrides: Partial<ArchitectureWire> = {}): ArchitectureWire {
  return {
    summary: 'An API that stores data.',
    capabilities: ['Store records', 'Serve an API'],
    groups: [{ id: 'backend', label: 'Backend', summary: null }],
    nodes: [
      node('api-handler', { groupId: 'backend', primaryPath: 'src/api/handler.ts', evidence: [ev('src/api/handler.ts', 1, 5)] }),
      node('data-store', { kind: 'data-store', groupId: 'backend', primaryPath: 'src/db/store.ts' }),
    ],
    edges: [{ from: 'api-handler', to: 'data-store', relationship: 'writes records', inferred: false, evidence: [ev('src/api/handler.ts', 10, 12)] }],
    limitations: [],
    ...overrides,
  }
}

describe('architecture validation', () => {
  it('accepts a valid graph and marks supported edges as cited', () => {
    const result = finaliseArchitecture(wire(), { ...extra, scope, references })
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    expect(result.value.graph.edges[0]).toMatchObject({ from: 'api-handler', to: 'data-store', support: 'cited' })
  })

  it('adds static-reference evidence at the exact import line, in the importing direction only', () => {
    const result = finaliseArchitecture(
      wire({
        edges: [
          { from: 'api-handler', to: 'data-store', relationship: 'writes', inferred: false, evidence: [] },
          { from: 'data-store', to: 'api-handler', relationship: 'notifies', inferred: false, evidence: [] },
        ],
      }),
      { ...extra, scope, references },
    )
    if (result.status !== 'valid') throw new Error('expected valid')
    const [forward, reverse] = result.value.graph.edges
    expect(forward).toMatchObject({
      support: 'static-reference',
      evidence: [{ path: 'src/api/handler.ts', startLine: 3, endLine: 3, origin: 'static-reference' }],
    })
    expect(reverse).toMatchObject({ support: 'inferred', evidence: [] })
  })

  it('repairs deterministically: unknown paths, groups, invalid evidence, self, dangling and duplicate edges', () => {
    const result = finaliseArchitecture(
      wire({
        nodes: [
          node('API Handler', { groupId: 'missing', primaryPath: './src/api/handler.ts', evidence: [ev('src/api/handler.ts', 25, 40)] }),
          node('data-store', { primaryPath: 'src/invented/file.ts' }),
        ],
        edges: [
          { from: 'api-handler', to: 'data-store', relationship: 'writes', inferred: false, evidence: [ev('https://evil.example/x', 1, 1)] },
          { from: 'api-handler', to: 'data-store', relationship: 'Writes', inferred: false, evidence: [ev('README.md', 2, 3)] },
          { from: 'api-handler', to: 'api-handler', relationship: 'recurses', inferred: false, evidence: [] },
          { from: 'api-handler', to: 'ghost', relationship: 'calls', inferred: false, evidence: [] },
        ],
      }),
      { ...extra, scope, references: [] },
    )
    if (result.status !== 'valid') throw new Error(JSON.stringify(result))
    const { nodes, edges, groups } = result.value.graph
    expect(nodes[0]).toMatchObject({ id: 'api-handler', groupId: null, primaryPath: 'src/api/handler.ts', evidence: [] })
    expect(nodes[1]!.primaryPath).toBeNull()
    expect(groups).toEqual([])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ support: 'documented', evidence: [{ path: 'README.md' }] })
    const kinds = new Set(result.repairs.map((repair) => repair.kind))
    for (const kind of ['unknown-group-cleared', 'unknown-path-cleared', 'evidence-rejected', 'duplicate-edge-merged', 'self-edge-removed', 'dangling-edge-removed'])
      expect(kinds, kind).toContain(kind)
  })

  it('matches an edge endpoint written as a node label', () => {
    const result = finaliseArchitecture(
      wire({ edges: [{ from: 'Api Handler', to: 'data store', relationship: 'writes', inferred: false, evidence: [] }] }),
      { ...extra, scope, references: [] },
    )
    if (result.status !== 'valid') throw new Error('expected valid')
    expect(result.value.graph.edges[0]).toMatchObject({ from: 'api-handler', to: 'data-store' })
  })

  it('asks for a model repair only for structural problems it cannot resolve', () => {
    const conflicting = finaliseArchitecture(
      wire({ nodes: [node('store'), node('store', { label: 'Different thing' })], edges: [] }),
      { ...extra, scope, references },
    )
    expect(conflicting).toMatchObject({ status: 'needs-model-repair', issues: [{ path: 'nodes.1.id' }] })

    const mostlyDangling = finaliseArchitecture(
      wire({
        edges: ['a', 'b', 'c', 'd'].map((id) => ({ from: `x-${id}`, to: 'data-store', relationship: 'calls', inferred: false, evidence: [] })),
      }),
      { ...extra, scope, references },
    )
    expect(mostlyDangling.status).toBe('needs-model-repair')

    const empty = finaliseArchitecture(wire({ nodes: [], edges: [] }), { ...extra, scope, references })
    expect(empty.status).toBe('needs-model-repair')
  })

  it('keeps components known only from the README or tree and labels their support honestly', () => {
    const result = finaliseArchitecture(
      wire({
        nodes: [
          node('api-handler', { primaryPath: 'src/api/handler.ts', evidence: [ev('src/api/handler.ts', 1, 5)] }),
          node('storage-layer', { kind: 'data-store', primaryPath: 'src/db', evidence: [] }),
          node('billing', { primaryPath: null, evidence: [ev('README.md', 2, 3)] }),
        ],
        edges: [],
      }),
      { ...extra, scope, references },
    )
    if (result.status !== 'valid') throw new Error(JSON.stringify(result))
    expect(result.value.graph.nodes.map((item) => [item.id, item.primaryPath, item.support])).toEqual([
      ['api-handler', 'src/api/handler.ts', 'cited'],
      ['storage-layer', 'src/db', 'structural'],
      ['billing', null, 'documented'],
    ])
    expect(result.value.capabilities).toEqual(['Store records', 'Serve an API'])
  })

  it('keeps one conceptual explanation per node, bounded in length, and attaches its primary source', () => {
    const long = `${'This component coordinates records across the product. '.repeat(30)}`
    const result = finaliseArchitecture(
      wire({ nodes: [node('api-handler', { primaryPath: 'src/api/handler.ts', explanation: `  ${long}` })], edges: [] }),
      { ...extra, scope, references },
    )
    if (result.status !== 'valid') throw new Error(JSON.stringify(result))
    const [only] = result.value.graph.nodes
    expect(only!.explanation.length).toBeLessThanOrEqual(900)
    expect(only!.explanation.startsWith('This component')).toBe(true)
    expect(only!.source).toMatchObject({ path: 'src/api/handler.ts', type: 'file' })
  })

  it('strips model-generated URLs from prose', () => {
    const result = finaliseArchitecture(
      wire({ summary: 'See https://evil.example/phish for details.' }),
      { ...extra, scope, references },
    )
    if (result.status !== 'valid') throw new Error('expected valid')
    expect(result.value.summary).not.toContain('evil.example')
  })
})

describe('static evidence ownership', () => {
  const nodes = [
    { id: 'web-app-shell', primaryPath: 'packages/front' },
    { id: 'notes-tasks', primaryPath: 'packages/front/src/modules/activities' },
    { id: 'record-views', primaryPath: 'packages/front/src/modules/object-record' },
    { id: 'record-cache', primaryPath: 'packages/front/src/modules/object-record/cache/getRecord.ts' },
  ]
  const ref = (fromPath: string, toPath: string, line = 4) => ({ fromPath, toPath, line })
  const childImport = ref('packages/front/src/modules/activities/useNotes.ts', 'packages/front/src/modules/object-record/useRecords.ts')

  it('credits the most specific importing node, not a broader ancestor', () => {
    expect(staticEvidenceFor('notes-tasks', 'record-views', [childImport], nodes)).toEqual({
      path: 'packages/front/src/modules/activities/useNotes.ts',
      startLine: 4,
      endLine: 4,
      origin: 'static-reference',
    })
    expect(staticEvidenceFor('web-app-shell', 'record-views', [childImport], nodes)).toBeNull()
  })

  it('lets a broad directory node own files no more specific node claims', () => {
    const shellImport = ref('packages/front/src/App.tsx', 'packages/front/src/modules/object-record/useRecords.ts', 12)
    expect(ownerOf('packages/front/src/App.tsx', nodes)).toBe('web-app-shell')
    expect(staticEvidenceFor('web-app-shell', 'record-views', [childImport, shellImport], nodes)).toMatchObject({
      path: 'packages/front/src/App.tsx',
      startLine: 12,
    })
  })

  it('gives a file to its exact file node before any enclosing directory node', () => {
    const cachePath = 'packages/front/src/modules/object-record/cache/getRecord.ts'
    expect(ownerOf(cachePath, nodes)).toBe('record-cache')
    const cacheImport = ref('packages/front/src/modules/activities/useNotes.ts', cachePath)
    expect(staticEvidenceFor('notes-tasks', 'record-cache', [cacheImport], nodes)).not.toBeNull()
    expect(staticEvidenceFor('notes-tasks', 'record-views', [cacheImport], nodes)).toBeNull()
  })

  it('attaches nothing when no node owns the importing or imported file', () => {
    const outside = ref('packages/server/src/main.ts', 'packages/front/src/modules/object-record/useRecords.ts')
    expect(ownerOf('packages/server/src/main.ts', nodes)).toBeNull()
    expect(staticEvidenceFor('web-app-shell', 'record-views', [outside], nodes)).toBeNull()
    expect(staticEvidenceFor('notes-tasks', 'record-views', [ref('packages/front/src/modules/activities/a.ts', 'lib/other.ts')], nodes)).toBeNull()
  })

  it('breaks ties between nodes with the same path by the smallest id', () => {
    const shared = [
      { id: 'zeta', primaryPath: 'src/api/handler.ts' },
      { id: 'alpha', primaryPath: 'src/api/handler.ts' },
    ]
    expect(ownerOf('src/api/handler.ts', shared)).toBe('alpha')
  })

  it('applies ownership when finalising a graph with nested directory nodes', () => {
    const result = finaliseArchitecture(
      wire({
        groups: [],
        nodes: [
          node('web-app-shell', { primaryPath: 'src' }),
          node('api-handler', { primaryPath: 'src/api' }),
          node('data-store', { primaryPath: 'src/db' }),
        ],
        edges: [
          { from: 'web-app-shell', to: 'data-store', relationship: 'reads', inferred: false, evidence: [] },
          { from: 'api-handler', to: 'data-store', relationship: 'writes', inferred: false, evidence: [] },
        ],
      }),
      { ...extra, scope, references },
    )
    if (result.status !== 'valid') throw new Error(JSON.stringify(result))
    expect(result.value.graph.nodes[0]!.primaryPath).toBe('src')
    const [shellEdge, apiEdge] = result.value.graph.edges
    expect(shellEdge).toMatchObject({ support: 'inferred', evidence: [] })
    expect(apiEdge).toMatchObject({
      support: 'static-reference',
      evidence: [{ path: 'src/api/handler.ts', startLine: 3, origin: 'static-reference' }],
    })
  })
})
