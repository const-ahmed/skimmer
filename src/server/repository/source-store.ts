import { GITHUB_LIMITS, REPOSITORY_LIMITS } from '@/server/analysis/limits'
import { splitLines } from './lines'
import { isReadablePath, isRootReadme, languageOf } from './paths'
import type { ReferenceResolver } from './references'
import type {
  RepositorySnapshot,
  SkipReason,
  SkippedEntry,
  SourceFile,
  TreeEntry,
} from './types'

export type BlobReader = (
  entry: TreeEntry,
  maxBytes: number,
  signal: AbortSignal,
) => Promise<Uint8Array | null>

interface StoredText {
  blobSha: string
  text: string
  lines: string[]
}

/**
 * Request-scoped source cache shared by the Architecture and User Flow
 * retrievals, so a file both need is fetched once.
 */
export interface SourceStore {
  read(paths: readonly string[]): Promise<void>
  get(path: string): SourceFile | undefined
  /** Text only; for config files read before references can be resolved. */
  getText(path: string): string | undefined
  has(path: string): boolean
  failure(path: string): SkipReason | undefined
  useResolver(resolver: ReferenceResolver): void
  resolveImport(fromPath: string, specifier: string): string | null
  skipped(): SkippedEntry[]
  bytesRead(): number
}

export function createSourceStore(options: {
  snapshot: RepositorySnapshot
  readBlob: BlobReader
  signal: AbortSignal
}): SourceStore {
  const { snapshot } = options
  const texts = new Map<string, StoredText>()
  const failures = new Map<string, SkipReason>()
  const built = new Map<string, SourceFile>()
  const inFlight = new Map<string, Promise<void>>()
  let resolver: ReferenceResolver | null = null
  let totalBytes = 0
  const deadline = AbortSignal.timeout(GITHUB_LIMITS.sourceReadDeadlineMs)
  const signal = AbortSignal.any([options.signal, deadline])

  const maxBytesFor = (path: string) =>
    isRootReadme(path)
      ? REPOSITORY_LIMITS.maxReadmeBytes
      : REPOSITORY_LIMITS.maxSourceFileBytes

  const readOne = async (path: string) => {
    const entry = snapshot.entries.get(path)
    if (!entry || entry.type !== 'blob' || !isReadablePath(path)) {
      failures.set(path, 'unavailable')
      return
    }
    const maxBytes = maxBytesFor(path)
    if (entry.size !== undefined && entry.size > maxBytes) {
      failures.set(path, 'too-large')
      return
    }
    if (totalBytes + (entry.size ?? 0) > REPOSITORY_LIMITS.maxTotalSourceBytes) {
      failures.set(path, 'read-budget')
      return
    }
    const bytes = await options.readBlob(entry, maxBytes, signal)
    if (!bytes) {
      failures.set(path, 'unavailable')
      return
    }
    const outcome = await decodeVerifiedBlob(bytes, entry.sha)
    if (typeof outcome === 'string') {
      failures.set(path, outcome)
      return
    }
    totalBytes += bytes.byteLength
    texts.set(path, {
      blobSha: entry.sha,
      text: outcome.text,
      lines: splitLines(outcome.text),
    })
  }

  return {
    async read(paths) {
      const unique = [...new Set(paths)].filter((path) => !texts.has(path) && !failures.has(path))
      // Retrievals run in parallel; a file already being fetched is awaited, not refetched.
      const waiting = unique.flatMap((path) => inFlight.get(path) ?? [])
      const pending = unique.filter((path) => !inFlight.has(path))
      let next = 0
      const workers = Array.from({ length: GITHUB_LIMITS.readConcurrency }, async () => {
        while (next < pending.length) {
          options.signal.throwIfAborted()
          const path = pending[next++]!
          if (deadline.aborted) {
            failures.set(path, 'unavailable')
            continue
          }
          const reading = readOne(path).catch(() => {
            options.signal.throwIfAborted()
            failures.set(path, 'unavailable')
          })
          inFlight.set(path, reading)
          try {
            await reading
          } finally {
            inFlight.delete(path)
          }
        }
      })
      await Promise.all([...workers, ...waiting])
    },
    get(path) {
      const cached = built.get(path)
      if (cached) return cached
      const stored = texts.get(path)
      if (!stored) return undefined
      const file: SourceFile = {
        path,
        commitSha: snapshot.identity.commitSha,
        blobSha: stored.blobSha,
        text: stored.text,
        lines: stored.lines,
        lineCount: stored.lines.length,
        language: languageOf(path),
        references: resolver ? resolver(path, stored.text) : [],
      }
      if (resolver) built.set(path, file)
      return file
    },
    getText: (path) => texts.get(path)?.text,
    has: (path) => texts.has(path),
    failure: (path) => failures.get(path),
    useResolver(next) {
      resolver = next
      built.clear()
    },
    resolveImport(fromPath, specifier) {
      if (!resolver || /['"\n]/.test(specifier)) return null
      return resolver(fromPath, `import '${specifier}'`)[0]?.toPath ?? null
    },
    skipped: () => [...failures].map(([path, reason]) => ({ path, reason })),
    bytesRead: () => totalBytes,
  }
}

const LFS_POINTER = 'version https://git-lfs.github.com/spec/v1'

/**
 * Accepts bytes only when they hash to the tree's blob SHA, contain no NUL
 * byte and decode as UTF-8. The hash check proves the content belongs to the
 * analysed commit even though it came from a CDN.
 */
export async function decodeVerifiedBlob(
  bytes: Uint8Array,
  blobSha: string,
): Promise<{ text: string } | SkipReason> {
  if (!(await matchesGitBlob(bytes, blobSha))) return 'blob-mismatch'
  if (bytes.includes(0)) return 'binary-content'
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return 'invalid-utf8'
  }
  if (text.startsWith(LFS_POINTER)) return 'lfs-pointer'
  return { text }
}

export async function matchesGitBlob(
  bytes: Uint8Array,
  blobSha: string,
): Promise<boolean> {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`)
  const payload = new Uint8Array(header.byteLength + bytes.byteLength)
  payload.set(header)
  payload.set(bytes, header.byteLength)
  const digest = await crypto.subtle.digest(
    blobSha.length === 64 ? 'SHA-256' : 'SHA-1',
    payload,
  )
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return hex === blobSha
}
