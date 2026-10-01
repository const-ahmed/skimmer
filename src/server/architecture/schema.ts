import { z } from 'zod'
import { ARCHITECTURE_LIMITS as LIMITS } from '@/server/analysis/limits'
import { evidenceSchema, modelEvidenceSchema } from '@/server/evidence/schema'

export const NODE_KINDS = [
  'entry-point',
  'ui',
  'api',
  'service',
  'domain',
  'data-store',
  'worker',
  'integration',
  'library',
  'config',
  'external-actor',
  'external-service',
] as const

const ID = /^[a-z][a-z0-9-]{0,63}$/

/**
 * Sent to Claude as the structured-output schema. Deliberately lenient: the
 * API does not enforce length or count limits, so those are checked by the
 * domain schema after deterministic repair.
 */
export const architectureWireSchema = z.object({
  summary: z.string().describe('What the product is and its principal user-to-result workflow, at most 60 words.'),
  // Written before any node, so components are chosen against the product, not the sample.
  capabilities: z
    .array(z.string())
    .describe('Major product capabilities from the README and repository structure, 3-10 short phrases, decided before choosing nodes.'),
  groups: z
    .array(
      z.object({
        id: z.string().describe('kebab-case id'),
        label: z.string().describe('2-4 words'),
        summary: z.string().nullable().describe('One short sentence, or null.'),
      }),
    )
    .describe(`Product subsystems, usually 3-6 for a substantial product, at most ${LIMITS.maxGroups}. Empty for tiny projects.`),
  nodes: z
    .array(
      z.object({
        id: z.string().describe('kebab-case id, unique'),
        label: z.string().describe('2-4 words naming the architectural responsibility or capability'),
        kind: z.enum(NODE_KINDS),
        groupId: z.string().nullable(),
        primaryPath: z
          .string()
          .nullable()
          .describe('Existing repository path that best represents the component boundary: a file, or a directory for a multi-file subsystem; null for external things.'),
        summary: z.string().describe('One sentence: what this component is for in the product.'),
        explanation: z
          .string()
          .describe('3-4 plain sentences for someone new to the codebase: what the component is, its role in the product, and how it relates to the parts around it. Conceptual, not a code walkthrough.'),
        evidence: z
          .array(modelEvidenceSchema)
          .describe('Shown lines supporting this component, if any. Empty when it is known only from the README or tree.'),
      }),
    )
    .describe(`Meaningful product components, usually 14-26 for a substantial application; at most ${LIMITS.maxNodes}.`),
  edges: z
    .array(
      z.object({
        from: z.string().describe('Node id of the caller/owner of the relationship.'),
        to: z.string(),
        relationship: z.string().describe('1-4 words, e.g. "calls", "reads sessions", "renders".'),
        inferred: z
          .boolean()
          .describe('true when the relationship is important but not shown in the provided source.'),
        evidence: z.array(modelEvidenceSchema),
      }),
    )
    .describe(`At most ${LIMITS.maxEdges} edges.`),
  limitations: z
    .array(z.string())
    .describe('Short notes on what could not be established from what was shown.'),
})

export type ArchitectureWire = z.infer<typeof architectureWireSchema>

const text = (max: number) => z.string().trim().min(1).max(max)

export const architectureGroupSchema = z.object({
  id: z.string().regex(ID),
  label: text(60),
  summary: text(300).optional(),
})

export const NODE_SUPPORT = ['cited', 'documented', 'structural'] as const

export const SOURCE_BASIS = ['cited', 'static-reference', 'primary-path', 'ranked-file', 'directory'] as const

export const sourceTargetSchema = z.object({
  path: z.string().min(1).max(1024),
  type: z.enum(['file', 'directory']),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  /** Which rule chose it; see selectPrimarySource. */
  basis: z.enum(SOURCE_BASIS),
  /** Commit-pinned GitHub link. */
  url: z.string().url(),
})

export type SourceTarget = z.infer<typeof sourceTargetSchema>

export const architectureNodeSchema = z.object({
  id: z.string().regex(ID),
  label: text(60),
  kind: z.enum(NODE_KINDS),
  groupId: z.string().regex(ID).nullable(),
  primaryPath: z.string().min(1).max(1024).nullable(),
  summary: text(300),
  explanation: text(900),
  /**
   * cited: shown source lines. documented: README only. structural: known
   * from the repository tree and paths, with no line evidence.
   */
  support: z.enum(NODE_SUPPORT),
  evidence: z.array(evidenceSchema),
  /** The one place to open to see this component; chosen by the application. */
  source: sourceTargetSchema.nullable(),
})

export const EDGE_SUPPORT = ['cited', 'static-reference', 'documented', 'inferred'] as const

export const architectureEdgeSchema = z.object({
  id: z.string(),
  from: z.string().regex(ID),
  to: z.string().regex(ID),
  relationship: text(60),
  /**
   * cited: the model cited shown source lines. static-reference: the source
   * analyser found an import at an exact line. documented: README only.
   * inferred: no evidence; a renderer should show it as unverified.
   */
  support: z.enum(EDGE_SUPPORT),
  evidence: z.array(evidenceSchema),
})

export const architectureGraphSchema = z.object({
  groups: z.array(architectureGroupSchema).max(LIMITS.maxGroups),
  nodes: z.array(architectureNodeSchema).min(1).max(LIMITS.maxNodes),
  edges: z.array(architectureEdgeSchema).max(LIMITS.maxEdges),
})

export const architectureResultSchema = z.object({
  summary: text(600),
  capabilities: z.array(text(200)).max(12),
  graph: architectureGraphSchema,
  limitations: z.array(text(400)).max(12),
})

export type ArchitectureResult = z.infer<typeof architectureResultSchema>
export type ArchitectureNode = z.infer<typeof architectureNodeSchema>
export type ArchitectureEdge = z.infer<typeof architectureEdgeSchema>
