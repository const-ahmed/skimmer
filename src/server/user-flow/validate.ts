import { USER_FLOW_LIMITS as LIMITS } from '@/server/analysis/limits'
import type { Finalised, Repair, StructuralIssue } from '@/server/analysis/issues'
import { normaliseText, shorten, slugify, stripUrls } from '@/server/analysis/text'
import type { EvidenceScope } from '@/server/evidence/scope'
import { checkEvidenceList } from '@/server/evidence/validate'
import {
  userFlowResultSchema,
  type UserFlow,
  type UserFlowResult,
  type UserFlowStep,
  type UserFlowWire,
} from './schema'

// Signs that a label describes execution rather than what a person does.
const CODE_LIKE =
  /\w\(|\(\)|=>|\/api\/|\b(?:GET|POST|PUT|PATCH|DELETE)\b|\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b|\.\w+\(|[{}<>;]/

export function looksLikeCode(label: string): boolean {
  return CODE_LIKE.test(label)
}

export interface UserFlowValidationInput {
  scope: EvidenceScope
  surface: UserFlowResult['surface']
}

export function finaliseUserFlows(
  wire: UserFlowWire,
  input: UserFlowValidationInput,
): Finalised<UserFlowResult> {
  const repairs: Repair[] = []
  const issues: StructuralIssue[] = []
  const warnings: string[] = []
  const repair = (kind: string, detail: string) => repairs.push({ kind, detail })
  const clean = (value: string, max: number) => shorten(stripUrls(normaliseText(value)), max).text
  const routes = new Set(input.surface.routes)

  if (wire.flows.length > LIMITS.maxFlows)
    repair('extra-flows-dropped', `${wire.flows.length - LIMITS.maxFlows} lowest-ranked flows`)

  const flowIds = new Set<string>()
  const flows: UserFlow[] = []
  wire.flows.slice(0, LIMITS.maxFlows).forEach((flow, flowIndex) => {
    const where = `flows.${flowIndex}`
    if (flow.steps.length > LIMITS.maxStepsPerFlow) {
      issues.push({
        path: `${where}.steps`,
        message: `${flow.steps.length} steps; the limit is ${LIMITS.maxStepsPerFlow}. Combine minor steps.`,
      })
      return
    }
    const stepIds = new Set<string>()
    const steps: UserFlowStep[] = flow.steps.map((step, stepIndex) => {
      const label = clean(step.label, 80)
      if (looksLikeCode(label))
        warnings.push(`${where}.steps.${stepIndex}: label "${label}" reads like code, not a user action.`)
      const { accepted, rejected } = checkEvidenceList(step.evidence, input.scope)
      for (const rejection of rejected)
        repair('evidence-rejected', `${where}.steps.${stepIndex}: ${rejection.path} (${rejection.reason})`)
      const explanation = step.explanation ? clean(step.explanation, 300) : ''
      return {
        id: uniqueId(slugify(step.id) || `step-${stepIndex + 1}`, stepIds),
        label,
        kind: step.kind,
        ...(explanation ? { explanation } : {}),
        evidence: accepted,
      }
    })
    if (steps.length < 2) return repair('short-flow-dropped', `${where} "${flow.title}"`)
    if (!steps.some((step) => step.evidence.length))
      return repair('ungrounded-flow-dropped', `${where} "${flow.title}" has no valid evidence`)
    let entryRoute = flow.entryRoute?.trim() || null
    if (entryRoute && !routes.has(entryRoute)) {
      repair('unknown-route-cleared', `${where}.entryRoute "${entryRoute}"`)
      entryRoute = null
    }
    const summary = flow.summary ? clean(flow.summary, 300) : ''
    flows.push({
      id: uniqueId(slugify(flow.id) || slugify(flow.title) || `flow-${flowIndex + 1}`, flowIds),
      title: clean(flow.title, 80),
      actor: clean(flow.actor, 60) || 'User',
      entryRoute,
      ...(summary ? { summary } : {}),
      steps,
    })
  })
  if (issues.length) return { status: 'needs-model-repair', issues, repairs }

  const reason = flows.length
    ? undefined
    : wire.flows.length
      ? 'Proposed flows were not supported by valid source evidence.'
      : clean(wire.noFlowsReason ?? '', 300) || 'The shown source does not support a human-facing task.'
  const candidate: UserFlowResult = {
    status: flows.length ? 'flows' : 'no-supported-flows',
    ...(reason ? { reason } : {}),
    surface: input.surface,
    flows,
    warnings,
  }
  const parsed = userFlowResultSchema.safeParse(candidate)
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

function uniqueId(base: string, used: Set<string>): string {
  let id = base
  for (let suffix = 2; used.has(id); suffix++) id = `${base.slice(0, 60)}-${suffix}`
  used.add(id)
  return id
}
