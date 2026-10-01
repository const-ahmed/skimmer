// Starting values, not yet benchmarked.

export const GITHUB_LIMITS = {
  requestTimeoutMs: 15_000,
  sourceReadDeadlineMs: 30_000,
  // Workers allow six connections waiting on headers at once.
  readConcurrency: 6,
  maxTruncatedFolderFetches: 8,
} as const

export const REPOSITORY_LIMITS = {
  maxSourceFileBytes: 512_000,
  maxReadmeBytes: 200_000,
  // Caps memory held for source text during one request.
  maxTotalSourceBytes: 12_000_000,
  maxTsconfigFiles: 8,
  maxTsconfigExtendsDepth: 3,
  maxReferencesPerFile: 40,
  maxSkippedEntriesReported: 200,
} as const

export const ARCHITECTURE_LIMITS = {
  excerptFiles: 16,
  referenceFiles: 28,
  firstRoundReferenceFiles: 12,
  listedFiles: 20,
  contextCharacters: 140_000,
  maxFileExcerptCharacters: 14_000,
  treeCharacters: 24_000,
  readmeCharacters: 10_000,
  sourceIndexCharacters: 12_000,
  coreModules: 16,
  referencesShownPerFile: 16,
  maxGroups: 10,
  maxNodes: 40,
  maxEdges: 80,
} as const

export const USER_FLOW_LIMITS = {
  maxPages: 12,
  maxChildComponentsPerPage: 4,
  maxHandlersPerPage: 3,
  maxFiles: 40,
  contextCharacters: 100_000,
  maxFileExcerptCharacters: 10_000,
  readmeCharacters: 4_000,
  maxRoutesListed: 80,
  maxFlows: 8,
  maxStepsPerFlow: 12,
} as const

export const MODEL_LIMITS = {
  model: 'claude-opus-5-5',
  effort: 'medium',
  maxOutputTokens: 32_000,
  repairMaxOutputTokens: 16_000,
  requestTimeoutMs: 240_000,
} as const

export const HTTP_LIMITS = {
  maxBodyBytes: 2_048,
  // Includes both model calls.
  analysisDeadlineMs: 360_000,
} as const
