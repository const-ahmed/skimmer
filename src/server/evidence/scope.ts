import type { LineRange } from '@/server/repository/types'

export interface ShownFile {
  path: string
  lineCount: number
  /** Exactly the lines the model saw, 1-based, sorted and merged. */
  ranges: LineRange[]
  lines: readonly string[]
  kind: 'source' | 'readme'
}

/** What a model may cite in one analysis: only what it was shown, at one commit. */
export interface EvidenceScope {
  commitSha: string
  files: ReadonlyMap<string, ShownFile>
  /** Every path in the snapshot, for path-only fields such as a node's primaryPath. */
  repositoryPaths: ReadonlySet<string>
}
