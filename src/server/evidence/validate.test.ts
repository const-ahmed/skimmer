import { describe, expect, it } from 'vitest'
import { githubBlobUrl } from '@/shared/evidence-links'
import type { EvidenceScope } from './scope'
import { checkEvidence, normaliseCitedPath } from './validate'

const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`)
lines[41] = 'const session = await verifySession(request)'

const scope: EvidenceScope = {
  commitSha: 'c'.repeat(40),
  files: new Map([
    [
      'src/handler.ts',
      {
        path: 'src/handler.ts',
        lineCount: 100,
        ranges: [{ start: 1, end: 10 }, { start: 40, end: 50 }],
        lines,
        kind: 'source' as const,
      },
    ],
  ]),
  repositoryPaths: new Set(['src/handler.ts', 'src/other.ts']),
}

const cite = (path: string, startLine: number, endLine: number, symbol: string | null = null) =>
  checkEvidence({ path, startLine, endLine, symbol }, scope)

describe('evidence validation', () => {
  it('accepts a range inside the lines that were shown', () => {
    expect(cite('src/handler.ts', 42, 44)).toEqual({
      ok: true,
      evidence: { path: 'src/handler.ts', startLine: 42, endLine: 44, origin: 'model' },
    })
  })

  it('normalises harmless path formatting', () => {
    expect(cite('./src/handler.ts', 42, 42).ok).toBe(true)
    expect(cite('/src/handler.ts', 42, 42).ok).toBe(true)
  })

  it.each([
    ['src/missing.ts', 1, 1, 'unknown-path'],
    ['src/other.ts', 1, 1, 'not-shown'],
    ['src/handler.ts', 0, 3, 'invalid-range'],
    ['src/handler.ts', 9, 3, 'invalid-range'],
    ['src/handler.ts', 1.5, 3, 'invalid-range'],
    ['src/handler.ts', 95, 120, 'outside-file'],
    ['src/handler.ts', 8, 12, 'outside-shown-lines'],
    ['src/handler.ts', 20, 20, 'outside-shown-lines'],
    ['src/handler.ts', 45, 55, 'outside-shown-lines'],
  ])('rejects %s:%s-%s as %s', (path, start, end, reason) => {
    expect(cite(path, start, end)).toMatchObject({ ok: false, reason })
  })

  it('never clamps a range that reaches into unshown lines', () => {
    const check = cite('src/handler.ts', 48, 60)
    expect(check.ok).toBe(false)
  })

  it.each([
    'https://github.com/acme/app/blob/main/src/handler.ts',
    'file:///etc/passwd',
    '../src/handler.ts',
    'src/../src/handler.ts',
    'src\\handler.ts',
    'src/handler.ts#L1',
  ])('rejects URL-like or escaping path %s', (path) => {
    expect(normaliseCitedPath(path)).toBeNull()
    expect(cite(path, 42, 42)).toMatchObject({ ok: false, reason: 'malformed-path' })
  })

  it('keeps a symbol only when it appears in the cited lines', () => {
    expect(cite('src/handler.ts', 42, 42, 'verifySession')).toMatchObject({ ok: true, evidence: { symbol: 'verifySession' } })
    const invented = cite('src/handler.ts', 42, 42, 'rateLimiter')
    expect(invented).toMatchObject({ ok: true })
    expect(invented.ok && invented.evidence.symbol).toBeUndefined()
  })

  it('derives exact commit-pinned GitHub links from coordinates', () => {
    expect(
      githubBlobUrl({ owner: 'acme', repo: 'app', commitSha: 'c'.repeat(40), path: 'src/a b.ts', startLine: 20, endLine: 40 }),
    ).toBe(`https://github.com/acme/app/blob/${'c'.repeat(40)}/src/a%20b.ts#L20-L40`)
  })
})
