import { describe, expect, it } from 'vitest'
import { snapshotOf } from '@/test/fixtures'
import { REPOSITORY_LIMITS } from '@/server/analysis/limits'
import { createReferenceResolver } from './references'
import { applyPathMappings, findConfigPaths, loadTsPathConfigs, parseJsonc } from './tsconfig-paths'

describe('tsconfig path mappings', () => {
  it('parses JSONC with comments and trailing commas without touching strings', () => {
    expect(
      parseJsonc('{\n // comment\n "a": "http://x/*y*/", /* block */\n "b": [1, 2,],\n}'),
    ).toEqual({ a: 'http://x/*y*/', b: [1, 2] })
  })

  it('prefers the longest matching prefix', () => {
    const mappings = [
      { pattern: '@/*', targets: ['src/*'] },
      { pattern: '@/components/*', targets: ['ui/components/*'] },
      { pattern: 'exact', targets: ['lib/exact'] },
    ]
    expect(applyPathMappings('@/components/button', mappings)).toEqual(['ui/components/button'])
    expect(applyPathMappings('@/lib/x', mappings)).toEqual(['src/lib/x'])
    expect(applyPathMappings('exact', mappings)).toEqual(['lib/exact'])
    expect(applyPathMappings('react', mappings)).toEqual([])
  })

  it('reads nested configs and follows in-repository extends', async () => {
    const files = {
      'tsconfig.base.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@shared/*": ["packages/shared/src/*"] } } }',
      'apps/web/tsconfig.json': '{ "extends": "../../tsconfig.base.json", // inherits paths\n "compilerOptions": { "strict": true } }',
      'apps/web/src/app.ts': '',
      'packages/shared/src/x.ts': '',
    }
    const snapshot = await snapshotOf(files)
    const texts = new Map(Object.entries(files))
    const configs = await loadTsPathConfigs(snapshot, async () => {}, (path) => texts.get(path))
    const web = configs.find((config) => config.directory === 'apps/web')
    expect(web?.mappings).toEqual([{ pattern: '@shared/*', targets: ['packages/shared/src/*'] }])
    expect(web?.baseUrl).toBe('')
  })

  it('resolves paths relative to the declaring config when baseUrl is absent', async () => {
    const files = {
      'apps/site/jsconfig.json': '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }',
    }
    const snapshot = await snapshotOf(files)
    const configs = await loadTsPathConfigs(snapshot, async () => {}, (path) => files[path as keyof typeof files])
    expect(configs[0]?.mappings).toEqual([{ pattern: '~/*', targets: ['apps/site/src/*'] }])
  })
})

describe('package-aware tsconfig discovery and resolution', () => {
  // Nine small shallow packages with their own tsconfig sort ahead of the big
  // server package under a "shallowest, then alphabetical" rule.
  const smallPackages = Array.from({ length: 9 }, (_, index) => `packages/a${index}`)
  const serverFiles = Array.from({ length: 40 }, (_, index) => `packages/server/src/modules/m${index}/service.ts`)
  const files: Record<string, string> = {
    ...Object.fromEntries(smallPackages.flatMap((root) => [
      [`${root}/tsconfig.json`, '{ "compilerOptions": {} }'],
      [`${root}/src/index.ts`, ''],
    ])),
    'tsconfig.base.json': '{ "compilerOptions": { "rootDir": "." } }',
    'packages/server/tsconfig.json':
      '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "paths": { "src/*": ["./src/*"] } } }',
    'packages/server/src/engine/orm/workspace.orm.ts': 'export const orm = 1',
    'packages/server/src/modules/workflow/runner.ts':
      "import { orm } from 'src/engine/orm/workspace.orm'\nimport { missing } from 'src/engine/nowhere'\nimport lodash from 'lodash'",
    ...Object.fromEntries(serverFiles.map((path) => [path, ''])),
    'packages/front/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/modules/*"] } } }',
    'packages/front/src/modules/records/useRecords.ts': 'export const useRecords = 1',
    'packages/front/src/modules/board/Board.tsx':
      "import { useRecords } from '@/records/useRecords'\nimport { orm } from 'src/engine/orm/workspace.orm'",
    ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`packages/front/src/modules/x${index}/y.ts`, ''])),
  }

  async function resolved() {
    const snapshot = await snapshotOf(files)
    const configs = await loadTsPathConfigs(snapshot, async () => {}, (path) => files[path])
    return { snapshot, configs, resolve: createReferenceResolver(snapshot.entries, configs) }
  }

  it('discovers the tsconfig of the package that governs the most source files', async () => {
    const snapshot = await snapshotOf(files)
    const found = findConfigPaths(snapshot)
    expect(found).toHaveLength(REPOSITORY_LIMITS.maxTsconfigFiles)
    expect(found.slice(0, 2)).toEqual(['packages/server/tsconfig.json', 'packages/front/tsconfig.json'])
  })

  it('resolves a package-local alias through that package tsconfig, with its line', async () => {
    const { resolve } = await resolved()
    const path = 'packages/server/src/modules/workflow/runner.ts'
    expect(resolve(path, files[path]!)).toEqual([
      { fromPath: path, toPath: 'packages/server/src/engine/orm/workspace.orm.ts', line: 1 },
    ])
  })

  it('gives each package its own aliases and keeps the frontend alias working', async () => {
    const { resolve } = await resolved()
    const path = 'packages/front/src/modules/board/Board.tsx'
    // "@/" follows the front config; "src/" is a server alias and must not leak into the front package.
    expect(resolve(path, files[path]!).map((reference) => reference.toPath)).toEqual([
      'packages/front/src/modules/records/useRecords.ts',
    ])
  })

  it('leaves unknown imports unresolved instead of guessing', async () => {
    const { resolve } = await resolved()
    const path = 'packages/server/src/modules/workflow/runner.ts'
    const targets = resolve(path, files[path]!).map((reference) => reference.toPath)
    expect(targets).not.toContain('packages/server/src/engine/nowhere')
    expect(targets.some((target) => target.includes('lodash'))).toBe(false)
  })

  it('is deterministic regardless of tree order', async () => {
    const snapshot = await snapshotOf(files)
    const reversed = { ...snapshot, entries: new Map([...snapshot.entries].reverse()) }
    expect(findConfigPaths(reversed)).toEqual(findConfigPaths(snapshot))
  })
})
