import type { AnalysisModel } from '@/server/ai'
import { AiError, type ModelCall, type ModelResponse } from '@/server/ai/claude'
import { buildArchitectureContext } from '@/server/architecture/retrieval'
import { finaliseArchitecture } from '@/server/architecture/validate'
import type { EvidenceScope } from '@/server/evidence/scope'
import type { GitHubClient } from '@/server/github/client'
import { resolveSnapshot } from '@/server/github/snapshot'
import { isGeneratedPath, isPeripheralPath } from '@/server/repository/paths'
import { createReferenceResolver } from '@/server/repository/references'
import { createSourceStore, type BlobReader } from '@/server/repository/source-store'
import { loadTsPathConfigs } from '@/server/repository/tsconfig-paths'
import type { RepositorySnapshot } from '@/server/repository/types'
import { buildUserFlowContext } from '@/server/user-flow/retrieval'
import type { UserFlowResult } from '@/server/user-flow/schema'
import { discoverCodeRoutes } from '@/server/user-flow/routes'
import { mergeCodeRoutes, scanUiSurface } from '@/server/user-flow/surface'
import { finaliseUserFlows } from '@/server/user-flow/validate'
import { parseGitHubRepository } from '@/shared/github-url'
import { AnalysisError } from './errors'
import type { Finalised, Repair, StructuralIssue } from './issues'
import type {
  AnalysisCoverage,
  AnalysisProgress,
  AnalysisResult,
  ShownFileSummary,
  ViewOutcome,
} from './result'

export interface AnalysisDependencies {
  github: GitHubClient
  model: AnalysisModel
}

export interface AnalysisOptions {
  signal: AbortSignal
  onProgress?: (progress: AnalysisProgress) => void
}

// No HTTP, streaming or storage here, so a cache can wrap this call keyed by (owner, repo, commitSha).
export async function analyseRepository(
  repositoryUrl: string,
  deps: AnalysisDependencies,
  options: AnalysisOptions,
): Promise<AnalysisResult> {
  const started = Date.now()
  const { signal } = options
  const progress = options.onProgress ?? (() => {})
  const ref = parseGitHubRepository(repositoryUrl)
  if (!ref)
    throw new AnalysisError('INVALID_REPOSITORY_URL', 'Enter a public GitHub repository URL, like https://github.com/owner/repo.', 400)

  progress({ stage: 'resolving-repository' })
  const snapshot = await resolveSnapshot(ref, deps.github)
  progress({ stage: 'repository-resolved', repository: snapshot.identity })

  progress({ stage: 'reading-source' })
  const readBlob: BlobReader = (entry, maxBytes, readSignal) =>
    deps.github.getRawFile(
      snapshot.identity.owner,
      snapshot.identity.repo,
      snapshot.identity.commitSha,
      entry.path,
      maxBytes,
      readSignal,
    )
  const store = createSourceStore({ snapshot, readBlob, signal })
  const tsConfigs = await loadTsPathConfigs(snapshot, store.read, store.getText)
  store.useResolver(createReferenceResolver(snapshot.entries, tsConfigs))
  const manifestText = await readManifests(snapshot, store)
  const surface = mergeCodeRoutes(
    scanUiSurface(snapshot.entries, manifestText),
    await discoverCodeRoutes(snapshot, store, manifestText),
  )

  const [architectureContext, userFlowContext] = await Promise.all([
    buildArchitectureContext(snapshot, store),
    surface ? buildUserFlowContext(snapshot, store, surface) : Promise.resolve(null),
  ])
  signal.throwIfAborted()

  const calls: ModelCall[] = []
  progress({ stage: 'analysing', views: userFlowContext ? ['architecture', 'user-flows'] : ['architecture'] })
  const [architecture, userFlows] = await Promise.all([
    runView({
      view: 'architecture',
      calls,
      progress,
      analyse: () => deps.model.analyseArchitecture(architectureContext.prompt, signal),
      finalise: (wire) =>
        finaliseArchitecture(wire, {
          scope: architectureContext.scope,
          references: architectureContext.references,
          repository: snapshot.identity,
          entries: snapshot.entries,
        }),
      repair: (previous, issues) =>
        deps.model.repairArchitecture(previous, issues, { paths: allowedPaths(architectureContext.scope) }, signal),
    }),
    userFlowContext
      ? runView({
          view: 'user-flows',
          calls,
          progress,
          analyse: () => deps.model.analyseUserFlows(userFlowContext.prompt, signal),
          finalise: (wire) =>
            finaliseUserFlows(wire, { scope: userFlowContext.scope, surface: userFlowContext.surface }),
          repair: (previous, issues) =>
            deps.model.repairUserFlows(
              previous,
              issues,
              { paths: allowedPaths(userFlowContext.scope), routes: userFlowContext.surface.routes },
              signal,
            ),
        })
      : Promise.resolve({
          outcome: {
            status: 'complete',
            data: {
              status: 'no-user-facing-surface',
              reason: 'No pages, views or templates a person interacts with were found.',
              surface: { frameworks: [], routes: [] },
              flows: [],
              warnings: [],
            },
          } satisfies ViewOutcome<UserFlowResult>,
          repairs: [] as Repair[],
        }),
  ])

  const coverage: AnalysisCoverage = {
    treeTruncated: snapshot.treeTruncated,
    entriesListed: snapshot.listedEntryCount,
    entriesKept: snapshot.entries.size,
    architecture: {
      shown: summariseScope(architectureContext.scope),
      readNotShown: architectureContext.readPaths.filter(
        (path) => !architectureContext.scope.files.has(path),
      ),
      treeOnly: architectureContext.unreadPaths,
      coreModules: architectureContext.coreModules,
      staticReferences: architectureContext.references,
    },
    userFlows: userFlowContext
      ? { shown: summariseScope(userFlowContext.scope), roles: userFlowContext.files }
      : null,
    skipped: [...snapshot.skipped, ...store.skipped()],
    sourceBytesRead: store.bytesRead(),
  }

  return {
    schemaVersion: 1,
    repository: { ...snapshot.identity, ...snapshot.metadata },
    coverage,
    architecture: architecture.outcome,
    userFlows: userFlows.outcome,
    diagnostics: {
      modelCalls: calls,
      repairs: { architecture: architecture.repairs, userFlows: userFlows.repairs },
      durationMs: Date.now() - started,
    },
  }
}

// At most one narrow model repair. A failure stays inside this view so the other view can still be returned.
export async function runView<Wire, Result>(params: {
  view: 'architecture' | 'user-flows'
  calls: ModelCall[]
  progress: (progress: AnalysisProgress) => void
  analyse: () => Promise<ModelResponse<Wire>>
  finalise: (wire: Wire) => Finalised<Result>
  repair: (previous: string, issues: StructuralIssue[]) => Promise<ModelResponse<Wire>>
}): Promise<{ outcome: ViewOutcome<Result>; repairs: Repair[] }> {
  const failed = (code: string, message: string, repairs: Repair[] = []) => ({
    outcome: { status: 'failed' as const, error: { code, message } },
    repairs,
  })
  try {
    const first = await params.analyse()
    params.calls.push(first.call)
    let previous: string
    let issues: StructuralIssue[]
    let repairs: Repair[] = []
    if (!first.ok) {
      if (first.failure === 'truncated')
        return failed('MODEL_OUTPUT_TRUNCATED', 'The model response was cut off before it was complete.')
      previous = first.raw
      issues = [{ path: 'output', message: 'The output was not valid JSON matching the schema.' }]
    } else {
      const result = params.finalise(first.value)
      if (result.status === 'valid') {
        params.progress({ stage: 'view-complete', view: params.view })
        return { outcome: { status: 'complete', data: result.value }, repairs: result.repairs }
      }
      previous = JSON.stringify(first.value)
      issues = result.issues
      repairs = result.repairs
    }

    params.progress({ stage: 'repairing', view: params.view })
    const second = await params.repair(previous, issues)
    params.calls.push(second.call)
    if (!second.ok) return failed('INVALID_MODEL_OUTPUT', 'The model output could not be repaired.', repairs)
    const repaired = params.finalise(second.value)
    if (repaired.status !== 'valid')
      return failed('INVALID_MODEL_OUTPUT', 'The model output could not be repaired.', [...repairs, ...repaired.repairs])
    params.progress({ stage: 'view-complete', view: params.view })
    return {
      outcome: { status: 'complete', data: repaired.value },
      repairs: [...repairs, { kind: 'model-repair', detail: issues.map((issue) => issue.path).join(', ') }, ...repaired.repairs],
    }
  } catch (error) {
    if (error instanceof AiError) return failed(error.code, error.message)
    throw error
  }
}

const MANIFEST = /(?:^|\/)package\.json$/

async function readManifests(
  snapshot: RepositorySnapshot,
  store: ReturnType<typeof createSourceStore>,
): Promise<string> {
  const paths = [...snapshot.entries.keys()]
    .filter(
      (path) =>
        MANIFEST.test(path) &&
        path.split('/').length <= 3 &&
        !isPeripheralPath(path) &&
        !isGeneratedPath(path),
    )
    .slice(0, 12)
  await store.read(paths)
  return paths.map((path) => store.getText(path) ?? '').join('\n')
}

function allowedPaths(scope: EvidenceScope): string[] {
  return [...scope.files.keys()]
}

function summariseScope(scope: EvidenceScope): ShownFileSummary[] {
  return [...scope.files.values()].map((file) => ({
    path: file.path,
    lineCount: file.lineCount,
    shownLines: file.ranges,
    complete:
      file.ranges.length === 1 && file.ranges[0]!.start === 1 && file.ranges[0]!.end === file.lineCount,
  }))
}
