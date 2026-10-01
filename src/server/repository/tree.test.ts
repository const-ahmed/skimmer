import { describe, expect, it } from 'vitest'
import { renderTreePaths, selectTreePaths } from './tree'
import type { TreeEntry } from './types'

function entriesOf(files: string[]): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>()
  const sha = 'a'.repeat(40)
  for (const file of files) {
    const parts = file.split('/')
    for (let index = 1; index < parts.length; index++) {
      const folder = parts.slice(0, index).join('/')
      entries.set(folder, { path: folder, type: 'tree', sha })
    }
    entries.set(file, { path: file, type: 'blob', sha, size: 1000 })
  }
  return entries
}

/** `count` source files spread over nested feature folders of one package. */
function packageFiles(root: string, features: string[], filesPerFeature: number): string[] {
  const files = [`${root}/package.json`]
  for (const feature of features)
    for (let index = 0; index < filesPerFeature; index++)
      files.push(`${root}/src/modules/${feature}/services/${feature}-handler-number-${index}.service.ts`)
  return files
}

const areaRoot = (paths: string[], root: string) => paths.includes(root)
const within = (paths: string[], root: string) => paths.filter((path) => path.startsWith(`${root}/`)).length

describe('representative tree selection', () => {
  const monorepo = [
    'package.json',
    ...packageFiles('packages/server', ['workflow', 'messaging', 'dashboard', 'ai', 'billing', 'auth'], 400),
    ...packageFiles('packages/front', ['records', 'views', 'settings', 'navigation'], 300),
    ...packageFiles('packages/sdk', ['cli', 'client'], 40),
    ...packageFiles('packages/companion', ['recording'], 20),
    ...packageFiles('packages/shared', ['types'], 30),
    'docs/guide/intro.md',
    'docs/guide/setup.md',
  ]
  const entries = entriesOf(monorepo)
  const budget = 6_000

  it('represents every major package of a large monorepo within a fixed budget', () => {
    const { paths } = selectTreePaths(entries, [], budget)
    for (const root of ['packages/server', 'packages/front', 'packages/sdk', 'packages/companion', 'packages/shared'])
      expect(areaRoot(paths, root), root).toBe(true)
    for (const root of ['packages/sdk', 'packages/companion', 'packages/shared'])
      expect(within(paths, root), root).toBeGreaterThan(2)
  })

  it('does not let one very large package crowd out the others', () => {
    const lopsided = entriesOf([
      ...packageFiles('packages/giant', Array.from({ length: 40 }, (_, index) => `feature${index}`), 200),
      ...packageFiles('packages/small-a', ['alpha'], 10),
      ...packageFiles('packages/small-b', ['beta'], 10),
    ])
    const { paths, directories } = selectTreePaths(lopsided, [], budget)
    // Small packages keep their root and whole directory structure; the giant gets more, not everything.
    for (const root of ['packages/small-a', 'packages/small-b']) {
      expect(paths, root).toContain(root)
      for (const dir of [...directories].filter((path) => path.startsWith(`${root}/`))) expect(paths, dir).toContain(dir)
    }
    const giantTotal = within([...lopsided.keys()], 'packages/giant')
    expect(within(paths, 'packages/giant')).toBeGreaterThan(within(paths, 'packages/small-a'))
    expect(within(paths, 'packages/giant')).toBeLessThan(giantTotal / 10)
  })

  it('shows the structure of a deep package before its leaf files', () => {
    const { paths, directories } = selectTreePaths(entries, [], budget)
    for (const feature of ['workflow', 'messaging', 'dashboard', 'ai'])
      expect(paths, feature).toContain(`packages/server/src/modules/${feature}`)
    // Every server directory is shown; leaf files only fill what is left.
    const allServerDirs = [...directories].filter((path) => path.startsWith('packages/server/'))
    for (const dir of allServerDirs) expect(paths, dir).toContain(dir)
    const serverFiles = paths.filter((path) => path.startsWith('packages/server/') && !directories.has(path))
    expect(serverFiles.length).toBeLessThan(within([...entries.keys()], 'packages/server') / 20)
    expect(renderTreePaths(selectTreePaths(entries, [], budget))).toContain('packages/server/src/modules/workflow/\n')
  })

  it('lists a small repository in full, as before', () => {
    const small = entriesOf(['package.json', 'README.md', 'src/index.ts', 'src/server.ts', 'src/db/store.ts', 'test/server.test.ts'])
    const selection = selectTreePaths(small, ['src/server.ts'], 24_000)
    expect(selection.paths).toEqual([...small.keys()].sort())
    expect(renderTreePaths(selection)).toContain('src/db/\nsrc/db/store.ts')
  })

  it('never exceeds the character budget', () => {
    for (const limit of [500, 2_000, 6_000, 24_000]) {
      const rendered = renderTreePaths(selectTreePaths(entries, [], limit))
      expect(rendered.length, String(limit)).toBeLessThanOrEqual(limit)
    }
  })

  it('is deterministic and keeps ranked files', () => {
    const ranked = ['packages/sdk/src/modules/cli/services/cli-handler-number-0.service.ts']
    const first = renderTreePaths(selectTreePaths(entries, ranked, budget))
    const second = renderTreePaths(selectTreePaths(new Map([...entries].reverse()), ranked, budget))
    expect(second).toBe(first)
    expect(first).toContain(ranked[0])
  })
})
