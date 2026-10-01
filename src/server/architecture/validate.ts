import { ARCHITECTURE_LIMITS as LIMITS } from '@/server/analysis/limits'
import type { Finalised, Repair, StructuralIssue } from '@/server/analysis/issues'
import { normaliseText, shorten, slugify, stripUrls } from '@/server/analysis/text'
import type { Evidence } from '@/server/evidence/schema'
import type { EvidenceScope } from '@/server/evidence/scope'
import { checkEvidenceList, normaliseCitedPath } from '@/server/evidence/validate'
import type { StaticReference, TreeEntry } from '@/server/repository/types'
import { ownerOf } from './ownership'
import { selectPrimarySource, type SourceSelectionContext } from './source'
import {
  architectureResultSchema,
  type ArchitectureEdge,
  type ArchitectureNode,
  type ArchitectureResult,
  type ArchitectureWire,
} from './schema'

export interface ArchitectureValidationInput {
  scope: EvidenceScope
  /** Static references from every file read, including ones not shown. */
  references: readonly StaticReference[]
  repository: SourceSelectionContext['repository']
  entries: ReadonlyMap<string, TreeEntry>
}

// Meaning-preserving problems are repaired here; anything else goes to one narrow model repair.
export function finaliseArchitecture(
  wire: ArchitectureWire,
  input: ArchitectureValidationInput,
): Finalised<ArchitectureResult> {
  const repairs: Repair[] = []
  const issues: StructuralIssue[] = []
  const repair = (kind: string, detail: string) => repairs.push({ kind, detail })
  const cleanText = (value: string, max: number, where: string) => {
    const normalised = stripUrls(normaliseText(value))
    if (normalised !== value.trim()) repair('text-normalised', where)
    const { text, cut } = shorten(normalised, max)
    if (cut) repair('text-shortened', where)
    return text
  }

  const groups: ArchitectureResult['graph']['groups'] = []
  const groupLabels = new Map<string, string>()
  wire.groups.forEach((group, index) => {
    const id = slugify(group.id)
    const label = cleanText(group.label, 60, `groups.${index}.label`)
    if (!id) return issues.push({ path: `groups.${index}.id`, message: `Invalid group id "${group.id}".` })
    if (groupLabels.has(id)) {
      if (groupLabels.get(id) === label) return repair('duplicate-group-removed', id)
      return issues.push({ path: `groups.${index}.id`, message: `Duplicate group id "${id}" with a different label.` })
    }
    groupLabels.set(id, label)
    const summary = group.summary ? cleanText(group.summary, 300, `groups.${index}.summary`) : ''
    groups.push({ id, label, ...(summary ? { summary } : {}) })
  })

  const nodes: ArchitectureNode[] = []
  const nodeById = new Map<string, ArchitectureNode>()
  wire.nodes.forEach((node, index) => {
    const where = `nodes.${index}`
    const id = slugify(node.id)
    if (!id) return issues.push({ path: `${where}.id`, message: `Invalid node id "${node.id}".` })
    const evidence = checkedEvidence(node.evidence, input.scope, where, repair)
    const existing = nodeById.get(id)
    if (existing) {
      if (normaliseText(node.label) === existing.label) {
        existing.evidence = mergeEvidence(existing.evidence, evidence)
        return repair('duplicate-node-merged', id)
      }
      return issues.push({ path: `${where}.id`, message: `Duplicate node id "${id}" used for different components.` })
    }
    let groupId = node.groupId ? slugify(node.groupId) : null
    if (groupId && !groupLabels.has(groupId)) {
      repair('unknown-group-cleared', `${where}.groupId "${node.groupId}"`)
      groupId = null
    }
    let primaryPath = node.primaryPath ? normaliseCitedPath(node.primaryPath) : null
    if (node.primaryPath && (!primaryPath || !input.scope.repositoryPaths.has(primaryPath))) {
      repair('unknown-path-cleared', `${where}.primaryPath "${node.primaryPath}"`)
      primaryPath = null
    }
    const built: ArchitectureNode = {
      id,
      label: cleanText(node.label, 60, `${where}.label`),
      kind: node.kind,
      groupId,
      primaryPath,
      summary: cleanText(node.summary, 300, `${where}.summary`),
      explanation: cleanText(node.explanation, 900, `${where}.explanation`),
      support: 'structural',
      evidence,
      source: null,
    }
    nodes.push(built)
    nodeById.set(id, built)
  })

  const labelIndex = new Map<string, string | null>()
  for (const node of nodes) {
    const key = slugify(node.label)
    labelIndex.set(key, labelIndex.has(key) ? null : node.id)
  }
  const resolveEndpoint = (raw: string) => {
    const id = slugify(raw)
    if (nodeById.has(id)) return id
    return labelIndex.get(id) ?? null
  }
  const edges: ArchitectureEdge[] = []
  const edgeByKey = new Map<string, ArchitectureEdge>()
  let dangling = 0
  wire.edges.forEach((edge, index) => {
    const where = `edges.${index}`
    const from = resolveEndpoint(edge.from)
    const to = resolveEndpoint(edge.to)
    if (!from || !to) {
      dangling++
      return repair('dangling-edge-removed', `${where} ${edge.from} -> ${edge.to}`)
    }
    if (from !== slugify(edge.from) || to !== slugify(edge.to))
      repair('edge-endpoint-matched-by-label', where)
    if (from === to) return repair('self-edge-removed', `${where} ${from}`)
    const relationship = cleanText(edge.relationship, 60, `${where}.relationship`)
    const modelEvidence = checkedEvidence(edge.evidence, input.scope, where, repair)
    const key = `${from}|${to}|${relationship.toLowerCase()}`
    const existing = edgeByKey.get(key)
    if (existing) {
      existing.evidence = mergeEvidence(existing.evidence, modelEvidence)
      return repair('duplicate-edge-merged', key)
    }
    const built: ArchitectureEdge = {
      id: `${from}--${to}--${edges.length + 1}`,
      from,
      to,
      relationship,
      support: 'inferred',
      evidence: modelEvidence,
    }
    edges.push(built)
    edgeByKey.set(key, built)
  })
  if (wire.edges.length && dangling > Math.max(2, wire.edges.length * 0.25))
    issues.push({
      path: 'edges',
      message: `${dangling} of ${wire.edges.length} edges reference node ids that do not exist.`,
    })

  for (const edge of edges) {
    const staticEvidence = staticEvidenceFor(edge.from, edge.to, input.references, nodes)
    if (staticEvidence) edge.evidence = mergeEvidence(edge.evidence, [staticEvidence])
    edge.support = supportOf(edge.evidence, input.scope)
  }
  // Nodes may rest on README or tree evidence alone; say so instead of implying source.
  for (const node of nodes) {
    const support = supportOf(node.evidence, input.scope)
    node.support = support === 'cited' ? 'cited' : support === 'documented' ? 'documented' : 'structural'
  }
  const sourceContext: SourceSelectionContext = {
    repository: input.repository,
    entries: input.entries,
    scope: input.scope,
    references: input.references,
    nodes,
  }
  for (const node of nodes) node.source = selectPrimarySource(node, sourceContext)

  const usedGroups = new Set(nodes.map((node) => node.groupId).filter(Boolean))
  const keptGroups = groups.filter((group) => {
    if (usedGroups.has(group.id)) return true
    repair('empty-group-removed', group.id)
    return false
  })

  if (!nodes.length) issues.push({ path: 'nodes', message: 'The graph has no valid nodes.' })
  if (nodes.length > LIMITS.maxNodes)
    issues.push({ path: 'nodes', message: `${nodes.length} nodes; the limit is ${LIMITS.maxNodes}. Merge minor components.` })
  if (edges.length > LIMITS.maxEdges)
    issues.push({ path: 'edges', message: `${edges.length} edges; the limit is ${LIMITS.maxEdges}. Keep the material ones.` })
  if (keptGroups.length > LIMITS.maxGroups)
    issues.push({ path: 'groups', message: `${keptGroups.length} groups; the limit is ${LIMITS.maxGroups}.` })
  if (issues.length) return { status: 'needs-model-repair', issues, repairs }

  const candidate: ArchitectureResult = {
    summary: cleanText(wire.summary, 600, 'summary') || 'No summary provided.',
    capabilities: wire.capabilities
      .map((capability, index) => cleanText(capability, 200, `capabilities.${index}`))
      .filter(Boolean)
      .slice(0, 12),
    graph: { groups: keptGroups, nodes, edges },
    limitations: wire.limitations
      .map((note, index) => cleanText(note, 400, `limitations.${index}`))
      .filter(Boolean)
      .slice(0, 12),
  }
  const parsed = architectureResultSchema.safeParse(candidate)
  if (!parsed.success)
    return {
      status: 'needs-model-repair',
      repairs,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'result',
        message: issue.message,
      })),
    }
  return { status: 'valid', value: parsed.data, repairs }
}

function checkedEvidence(
  list: ArchitectureWire['nodes'][number]['evidence'],
  scope: EvidenceScope,
  where: string,
  repair: (kind: string, detail: string) => void,
): Evidence[] {
  const { accepted, rejected } = checkEvidenceList(list, scope)
  for (const rejection of rejected)
    repair('evidence-rejected', `${where}: ${rejection.path} (${rejection.reason})`)
  return accepted
}

function mergeEvidence(existing: Evidence[], added: readonly Evidence[]): Evidence[] {
  const keys = new Set(existing.map((item) => `${item.path}:${item.startLine}-${item.endLine}`))
  return [
    ...existing,
    ...added.filter((item) => !keys.has(`${item.path}:${item.startLine}-${item.endLine}`)),
  ]
}

// Only the importing side owns a relationship, so only that direction is checked.
export function staticEvidenceFor(
  fromId: string,
  toId: string,
  references: readonly StaticReference[],
  nodes: readonly Pick<ArchitectureNode, 'id' | 'primaryPath'>[],
): Evidence | null {
  if (fromId === toId) return null
  const match = references.find(
    (reference) => ownerOf(reference.fromPath, nodes) === fromId && ownerOf(reference.toPath, nodes) === toId,
  )
  return match
    ? { path: match.fromPath, startLine: match.line, endLine: match.line, origin: 'static-reference' }
    : null
}

function supportOf(evidence: readonly Evidence[], scope: EvidenceScope): ArchitectureEdge['support'] {
  const modelCited = evidence.filter((item) => item.origin === 'model')
  if (modelCited.some((item) => scope.files.get(item.path)?.kind === 'source')) return 'cited'
  if (evidence.some((item) => item.origin === 'static-reference')) return 'static-reference'
  if (modelCited.length) return 'documented'
  return 'inferred'
}
