import { describe, expect, it } from 'vitest'
import { rankArchitecturePaths, scoreArchitecturePath } from './ranking'
import type { TreeEntry } from './types'

function entries(files: Record<string, number>): Map<string, TreeEntry> {
  return new Map(
    Object.entries(files).map(([path, size]) => [path, { path, type: 'blob', sha: 'a'.repeat(40), size }]),
  )
}

describe('architecture ranking', () => {
  it('prefers entry points, routes and services over helpers and scripts', () => {
    expect(scoreArchitecturePath('src/server.ts')).toBeGreaterThan(scoreArchitecturePath('src/utils.ts'))
    expect(scoreArchitecturePath('app/api/generate/route.ts')).toBeGreaterThan(
      scoreArchitecturePath('app/lib/format.ts'),
    )
    expect(scoreArchitecturePath('src/billing/service.ts')).toBeGreaterThan(
      scoreArchitecturePath('scripts/seed.ts'),
    )
    expect(scoreArchitecturePath('src/logger.ts')).toBeLessThan(scoreArchitecturePath('src/router.ts'))
  })

  it('spreads picks across directories instead of exhausting one folder', () => {
    const files: Record<string, number> = { 'src/other/engine.ts': 8_000 }
    for (let index = 0; index < 8; index++) files[`app/api/r${index}/route.ts`] = 4_000
    const ranked = rankArchitecturePaths(entries(files), 5)
    expect(ranked).toContain('src/other/engine.ts')
  })

  it('includes at most one manifest and demotes tiny barrels', () => {
    const ranked = rankArchitecturePaths(
      entries({
        'package.json': 900,
        'packages/a/package.json': 900,
        'src/index.ts': 120,
        'src/pipeline.ts': 9_000,
      }),
      4,
    )
    expect(ranked.filter((path) => path.endsWith('package.json'))).toHaveLength(1)
    expect(ranked.indexOf('src/pipeline.ts')).toBeLessThan(ranked.indexOf('src/index.ts'))
  })

  it('skips tests, oversized files and non-source files', () => {
    const ranked = rankArchitecturePaths(
      entries({ 'src/a.test.ts': 100, 'src/huge.ts': 10_000_000, 'README.md': 100, 'src/a.ts': 100 }),
      10,
    )
    expect(ranked).toEqual(['src/a.ts'])
  })
})
