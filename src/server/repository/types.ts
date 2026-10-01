export interface RepositoryIdentity {
  owner: string
  repo: string
  defaultBranch: string
  commitSha: string
}

/** Repository-authored metadata; untrusted like any repository content. */
export interface RepositoryMetadata {
  description: string | null
  primaryLanguage: string | null
  topics: string[]
}

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
  /** Blob size in bytes; absent for trees. */
  size?: number
}

export type SkipReason =
  | 'submodule'
  | 'symlink'
  | 'sensitive'
  | 'too-large'
  | 'binary-content'
  | 'invalid-utf8'
  | 'lfs-pointer'
  | 'blob-mismatch'
  | 'unavailable'
  | 'read-budget'

export interface SkippedEntry {
  path: string
  reason: SkipReason
}

/** One immutable repository version: everything later is read from `commitSha`. */
export interface RepositorySnapshot {
  identity: RepositoryIdentity
  metadata: RepositoryMetadata
  /** Tree entries after dependency/cache folders and binary assets are dropped. */
  entries: ReadonlyMap<string, TreeEntry>
  skipped: SkippedEntry[]
  /** GitHub returned a partial recursive listing. */
  treeTruncated: boolean
  /** Entries GitHub listed before local filtering. */
  listedEntryCount: number
}

export interface LineRange {
  /** 1-based, inclusive. */
  start: number
  end: number
}

/** A static import/reference. Proves the files are related, not that code runs. */
export interface StaticReference {
  fromPath: string
  toPath: string
  line: number
}

/** Source held only while the request is active. */
export interface SourceFile {
  path: string
  commitSha: string
  blobSha: string
  text: string
  lines: readonly string[]
  lineCount: number
  language: string
  references: StaticReference[]
}
