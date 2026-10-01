import { z } from 'zod'

/** What the model returns: coordinates only, never URLs. */
export const modelEvidenceSchema = z.object({
  path: z.string().describe('Exact repository path of a file shown to you.'),
  startLine: z.number().int().describe('First cited line, as numbered in the shown file.'),
  endLine: z.number().int().describe('Last cited line, inclusive. Every line in the range must have been shown.'),
  symbol: z
    .string()
    .nullable()
    .describe('Function, component or class name visible in the cited lines, or null.'),
})

export type ModelEvidence = z.infer<typeof modelEvidenceSchema>

export const evidenceSchema = z.object({
  path: z.string().min(1).max(1024),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbol: z.string().max(120).optional(),
  /** "static-reference": located by the source analyser, not the model. */
  origin: z.enum(['model', 'static-reference']),
})

export type Evidence = z.infer<typeof evidenceSchema>
