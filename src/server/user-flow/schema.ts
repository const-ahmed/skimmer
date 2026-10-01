import { z } from 'zod'
import { USER_FLOW_LIMITS as LIMITS } from '@/server/analysis/limits'
import { evidenceSchema, modelEvidenceSchema } from '@/server/evidence/schema'

export const STEP_KINDS = ['navigate', 'view', 'input', 'action', 'feedback', 'result'] as const

export const userFlowWireSchema = z.object({
  flows: z
    .array(
      z.object({
        id: z.string().describe('kebab-case id'),
        title: z.string().describe('The person\'s goal in 2-6 words, e.g. "Create a profile".'),
        actor: z.string().describe('Who does this, e.g. "Visitor", "Signed-in user".'),
        entryRoute: z
          .string()
          .nullable()
          .describe('Route from the discovered routes list where the flow starts, or null.'),
        summary: z.string().nullable().describe('One sentence, or null.'),
        steps: z
          .array(
            z.object({
              id: z.string().describe('kebab-case id, unique within the flow'),
              label: z
                .string()
                .describe('What the person does or experiences, 2-6 words, e.g. "Enter profile details". Never code names.'),
              kind: z.enum(STEP_KINDS),
              explanation: z.string().nullable().describe('One plain sentence, or null.'),
              evidence: z.array(modelEvidenceSchema),
            }),
          )
          .describe(`2 to ${LIMITS.maxStepsPerFlow} steps in the order the person experiences them.`),
      }),
    )
    .describe(`Distinct tasks a person performs, most important first, at most ${LIMITS.maxFlows}. Empty when the source shows none.`),
  noFlowsReason: z
    .string()
    .nullable()
    .describe('When flows is empty, one sentence saying why; otherwise null.'),
})

export type UserFlowWire = z.infer<typeof userFlowWireSchema>

const ID = /^[a-z][a-z0-9-]{0,63}$/
const text = (max: number) => z.string().trim().min(1).max(max)

export const userFlowStepSchema = z.object({
  id: z.string().regex(ID),
  label: text(80),
  kind: z.enum(STEP_KINDS),
  explanation: text(300).optional(),
  evidence: z.array(evidenceSchema),
})

export const userFlowSchema = z.object({
  id: z.string().regex(ID),
  title: text(80),
  actor: text(60),
  entryRoute: z.string().max(300).nullable(),
  summary: text(300).optional(),
  steps: z.array(userFlowStepSchema).min(2).max(LIMITS.maxStepsPerFlow),
})

export const userFlowResultSchema = z.object({
  status: z.enum(['flows', 'no-user-facing-surface', 'no-supported-flows']),
  reason: text(300).optional(),
  surface: z.object({
    frameworks: z.array(z.string()),
    routes: z.array(z.string()),
  }),
  flows: z.array(userFlowSchema).max(LIMITS.maxFlows),
  warnings: z.array(z.string()),
})

export type UserFlow = z.infer<typeof userFlowSchema>
export type UserFlowStep = z.infer<typeof userFlowStepSchema>
export type UserFlowResult = z.infer<typeof userFlowResultSchema>
