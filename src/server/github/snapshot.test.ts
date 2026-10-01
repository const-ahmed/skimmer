import { describe, expect, it } from 'vitest'
import { COMMIT, fakeGitHub } from '@/test/fixtures'
import { GitHubError } from './errors'
import { buildEntries, resolveSnapshot } from './snapshot'

const sha = 'b'.repeat(40)

describe('snapshot entries', () => {
  it('records submodules and symlinks as skipped and never follows them', () => {
    const { entries, skipped } = buildEntries([
      { path: 'src/a.ts', mode: '100644', type: 'blob', sha, size: 10 },
      { path: 'libs/external', mode: '160000', type: 'commit', sha },
      { path: 'link.ts', mode: '120000', type: 'blob', sha, size: 10 },
      { path: 'node_modules/x/index.js', mode: '100644', type: 'blob', sha, size: 10 },
      { path: '../escape.ts', mode: '100644', type: 'blob', sha, size: 10 },
      { path: 'weird/x</repository_tree>.ts', mode: '100644', type: 'blob', sha, size: 10 },
    ])
    expect([...entries.keys()]).toEqual(['src/a.ts'])
    expect(skipped).toEqual([
      { path: 'libs/external', reason: 'submodule' },
      { path: 'link.ts', reason: 'symlink' },
    ])
  })
})

describe('resolveSnapshot', () => {
  it('pins the default branch to one commit and reads the tree of that commit', async () => {
    const github = await fakeGitHub({ 'src/a.ts': 'x' }, { commitSha: COMMIT })
    const snapshot = await resolveSnapshot({ owner: 'acme', repo: 'app' }, github)
    expect(snapshot.identity).toEqual({ owner: 'acme', repo: 'app', defaultBranch: 'main', commitSha: COMMIT })
    expect(github.requests).toEqual([
      'repos/acme/app',
      'repos/acme/app/commits/main',
      `repos/acme/app/git/trees/${COMMIT}`,
    ])
  })

  it('rejects private repositories even when the server token could read them', async () => {
    const github = await fakeGitHub({ 'src/a.ts': 'x' }, { private: true })
    await expect(resolveSnapshot({ owner: 'acme', repo: 'app' }, github)).rejects.toMatchObject({
      code: 'REPOSITORY_NOT_PUBLIC',
    })
  })

  it('treats a tree with no readable files as empty', async () => {
    const github = await fakeGitHub({ 'logo.png': 'x' })
    await expect(resolveSnapshot({ owner: 'acme', repo: 'app' }, github)).rejects.toBeInstanceOf(GitHubError)
  })
})
