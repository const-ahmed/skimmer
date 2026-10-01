import { describe, expect, it } from 'vitest'
import { COMMIT, snapshotOf, storeOf } from '@/test/fixtures'
import { createSourceStore } from './source-store'

describe('source store', () => {
  it('keeps provenance: commit, blob SHA, lines and resolved references', async () => {
    const { store, snapshot } = await storeOf({
      'src/a.ts': 'import { b } from "./b"\nb()\n',
      'src/b.ts': 'export const b = () => 1\n',
    })
    await store.read(['src/a.ts'])
    const file = store.get('src/a.ts')!
    expect(file.commitSha).toBe(COMMIT)
    expect(file.blobSha).toBe(snapshot.entries.get('src/a.ts')!.sha)
    expect(file.lineCount).toBe(2)
    expect(file.language).toBe('ts')
    expect(file.references).toEqual([{ fromPath: 'src/a.ts', toPath: 'src/b.ts', line: 1 }])
  })

  it('rejects content that does not hash to the tree blob (a different version)', async () => {
    const { store } = await storeOf({ 'a.ts': 'original' }, { override: { 'a.ts': 'changed after the tree was read' } })
    await store.read(['a.ts'])
    expect(store.has('a.ts')).toBe(false)
    expect(store.failure('a.ts')).toBe('blob-mismatch')
  })

  it('skips binary content, invalid UTF-8 and LFS pointers', async () => {
    const { store } = await storeOf({
      'bin.ts': new Uint8Array([104, 0, 105]),
      'latin1.ts': new Uint8Array([0xff, 0xfe, 0x41]),
      'model.ts': 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n',
    })
    await store.read(['bin.ts', 'latin1.ts', 'model.ts'])
    expect(store.failure('bin.ts')).toBe('binary-content')
    expect(store.failure('latin1.ts')).toBe('invalid-utf8')
    expect(store.failure('model.ts')).toBe('lfs-pointer')
  })

  it('never reads sensitive files or paths outside the snapshot', async () => {
    const { store, snapshot } = await storeOf({ 'src/a.ts': 'x', '.env': 'SECRET=1' })
    expect(snapshot.entries.has('.env')).toBe(false)
    expect(snapshot.skipped).toContainEqual({ path: '.env', reason: 'sensitive' })
    await store.read(['.env', '../etc/passwd'])
    expect(store.has('.env')).toBe(false)
    expect(store.has('../etc/passwd')).toBe(false)
  })

  it('refuses files over the size limit without fetching them', async () => {
    const big = 'x'.repeat(600_000)
    const { store } = await storeOf({ 'big.ts': big })
    await store.read(['big.ts'])
    expect(store.failure('big.ts')).toBe('too-large')
  })
})

describe('shared reads', () => {
  it('fetches a file once when parallel retrievals ask for it together', async () => {
    const snapshot = await snapshotOf({ 'a.ts': 'x' })
    let fetches = 0
    const store = createSourceStore({
      snapshot,
      signal: new AbortController().signal,
      readBlob: async () => {
        fetches++
        await new Promise((resolve) => setTimeout(resolve, 5))
        return new TextEncoder().encode('x')
      },
    })
    await Promise.all([store.read(['a.ts']), store.read(['a.ts'])])
    expect(fetches).toBe(1)
    expect(store.has('a.ts')).toBe(true)
  })
})
