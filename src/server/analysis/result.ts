import type { ModelCall } from '@/server/ai/claude'
import type { ArchitectureResult } from '@/server/architecture/schema'
import type {
  LineRange,
  RepositoryIdentity,
  RepositoryMetadata,
  SkippedEntry,
  StaticReference,
} from '@/server/repository/types'
import type { UserFlowResult } from '@/server/user-flow/schema'
import type { Repair } from './issues'

export type ViewOutcome<T> =
  | { status: 'complete'; data: T }
  | { status: 'failed'; error: { code: string; message: string } }

export interface ShownFileSummary {
  path: string
  lineCount: number
  /** Exactly the lines supplied to the model. */
  shownLines: LineRange[]
  complete: boolean
}

export interface AnalysisCoverage {
  treeTruncated: boolean
  entriesListed: number
  entriesKept: number
  architecture: {
    shown: ShownFileSummary[]
    /** Read in full for references but not shown to the model. */
    readNotShown: string[]
    /** Known only from the tree. */
    treeOnly: string[]
    coreModules: string[]
    staticReferences: StaticReference[]
  }
  userFlows: {
    shown: ShownFileSummary[]
    roles: Array<{ path: string; role: string; note: string }>
  } | null
  skipped: SkippedEntry[]
  sourceBytesRead: number
}

export interface AnalysisDiagnostics {
  modelCalls: ModelCall[]
  repairs: { architecture: Repair[]; userFlows: Repair[] }
  durationMs: number
}

export interface AnalysisResult {
  schemaVersion: 1
  repository: RepositoryIdentity & RepositoryMetadata
  coverage: AnalysisCoverage
  architecture: ViewOutcome<ArchitectureResult>
  userFlows: ViewOutcome<UserFlowResult>
  diagnostics: AnalysisDiagnostics
}

export type AnalysisProgress =
  | { stage: 'resolving-repository' }
  | { stage: 'repository-resolved'; repository: RepositoryIdentity }
  | { stage: 'reading-source' }
  | { stage: 'analysing'; views: Array<'architecture' | 'user-flows'> }
  | { stage: 'repairing'; view: 'architecture' | 'user-flows' }
  | { stage: 'view-complete'; view: 'architecture' | 'user-flows' }
