import { describe, expect, it } from 'vitest'
import type { EvidenceScope } from '@/server/evidence/scope'
import type { TreeEntry } from '@/server/repository/types'
import { githubTreeUrl } from '@/shared/evidence-links'
import type { ArchitectureNode } from './schema'
import { selectPrimarySource, type SourceSelectionContext } from './source'

const commitSha = 'c'.repeat(40)
const repository = { owner: 'acme', repo: 'app', commitSha }

function entriesOf(files: string[]): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>()
  for (const file of files) {
    const parts = file.split('/')
    for (let index = 1; index < parts.length; index++) {
      const folder = parts.slice(0, index).join('/')
      entries.set(folder, { path: folder, type: 'tree', sha: 'a'.repeat(40) })
    }
    entries.set(file, { path: file, type: 'blob', sha: 'a'.repeat(40), size: 4000 })
  }
  return entries
}

const entries = entriesOf([
  'README.md',
  'server/src/main.ts',
  'server/src/utils/format.ts',
  'server/src/billing/billing.service.ts',
  'server/src/billing/billing.types.ts',
  'server/src/queue/worker.ts',
  'server/test/billing.test.ts',
  'docs/guide/intro.md',
])

const scope: EvidenceScope = {
  commitSha,
  files: new Map([
    ['server/src/billing/billing.service.ts', { path: 'server/src/billing/billing.service.ts', lineCount: 80, ranges: [{ start: 1, end: 80 }], lines: [], kind: 'source' }],
    ['README.md', { path: 'README.md', lineCount: 20, ranges: [{ start: 1, end: 20 }], lines: [], kind: 'readme' }],
  ]),
  repositoryPaths: new Set(entries.keys()),
}

type Node = Pick<ArchitectureNode, 'id' | 'kind' | 'primaryPath' | 'evidence'>
const node = (id: string, primaryPath: string | null, overrides: Partial<Node> = {}): Node => ({
  id,
  kind: 'service',
  primaryPath,
  evidence: [],
  ...overrides,
})

const nodes = [
  { id: 'server', primaryPath: 'server' },
  { id: 'billing', primaryPath: 'server/src/billing' },
  { id: 'worker', primaryPath: 'server/src/queue/worker.ts' },
  { id: 'docs', primaryPath: 'docs' },
]
const context = (references: SourceSelectionContext['references'] = []): SourceSelectionContext => ({
  repository,
  entries,
  scope,
  references,
  nodes,
})

describe('primary source selection', () => {
  it('prefers the first cited range in shown source, with its lines', () => {
    const target = selectPrimarySource(
      node('billing', 'server/src/billing', {
        evidence: [
          { path: 'README.md', startLine: 2, endLine: 4, origin: 'model' },
          { path: 'server/src/billing/billing.service.ts', startLine: 10, endLine: 24, origin: 'model' },
        ],
      }),
      context(),
    )
    expect(target).toEqual({
      path: 'server/src/billing/billing.service.ts',
      type: 'file',
      startLine: 10,
      endLine: 24,
      basis: 'cited',
      url: `https://github.com/acme/app/blob/${commitSha}/server/src/billing/billing.service.ts#L10-L24`,
    })
  })

  it('prefers the component\'s own files over a citation of another component\'s file', () => {
    const citesNestedFile = node('server', 'server', {
      evidence: [{ path: 'server/src/billing/billing.service.ts', startLine: 3, endLine: 4, origin: 'model' }],
    })
    // The cited file belongs to the nested billing node, so server uses its own best file.
    expect(selectPrimarySource(citesNestedFile, context())).toMatchObject({ path: 'server/src/main.ts', basis: 'ranked-file' })
    const docs = node('docs', 'docs', {
      evidence: [{ path: 'server/src/billing/billing.service.ts', startLine: 3, endLine: 4, origin: 'model' }],
    })
    // With no file of its own, an outside citation still beats a bare directory.
    expect(selectPrimarySource(docs, context())).toMatchObject({ path: 'server/src/billing/billing.service.ts', basis: 'cited' })
  })

  it('falls back to a read file the node owns, then to a file primaryPath', () => {
    const references = [
      { fromPath: 'server/src/billing/billing.service.ts', toPath: 'server/src/main.ts', line: 3 },
      { fromPath: 'server/src/main.ts', toPath: 'server/src/billing/billing.service.ts', line: 5 },
    ]
    expect(selectPrimarySource(node('server', 'server'), context(references))).toMatchObject({
      path: 'server/src/main.ts',
      basis: 'static-reference',
      type: 'file',
    })
    expect(selectPrimarySource(node('worker', 'server/src/queue/worker.ts'), context())).toMatchObject({
      path: 'server/src/queue/worker.ts',
      basis: 'primary-path',
      url: `https://github.com/acme/app/blob/${commitSha}/server/src/queue/worker.ts`,
    })
  })

  it('ranks files inside a directory node, skipping files owned by nested nodes and tests', () => {
    expect(selectPrimarySource(node('server', 'server'), context())).toMatchObject({
      path: 'server/src/main.ts',
      basis: 'ranked-file',
    })
    expect(selectPrimarySource(node('billing', 'server/src/billing'), context())).toMatchObject({
      path: 'server/src/billing/billing.service.ts',
      basis: 'ranked-file',
    })
  })

  it('uses the directory only when it holds no source file, and links it with tree/', () => {
    expect(selectPrimarySource(node('docs', 'docs'), context())).toEqual({
      path: 'docs',
      type: 'directory',
      basis: 'directory',
      url: githubTreeUrl({ ...repository, path: 'docs' }),
    })
    expect(githubTreeUrl({ ...repository, path: 'docs/my guide' })).toBe(`https://github.com/acme/app/tree/${commitSha}/docs/my%20guide`)
  })

  it('gives external systems and pathless nodes no source link', () => {
    expect(selectPrimarySource(node('redis', null, { kind: 'external-service' }), context())).toBeNull()
    expect(
      selectPrimarySource(
        node('user', 'server/src/main.ts', { kind: 'external-actor' }),
        context(),
      ),
    ).toBeNull()
    expect(selectPrimarySource(node('unknown', null), context())).toBeNull()
  })
})
