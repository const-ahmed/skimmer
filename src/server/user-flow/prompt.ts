import { USER_FLOW_LIMITS as LIMITS } from '@/server/analysis/limits'
import { UNTRUSTED_INPUT_RULES } from '@/server/ai/prompt-rules'

export const USER_FLOW_SYSTEM_PROMPT = `You describe what a HUMAN USER of one application actually does and experiences, as short step-by-step journeys.

${UNTRUSTED_INPUT_RULES}

What a user flow is
- A task a person performs through the interface, told from their side: what they open, enter, click, wait for and see.
- Good steps: "Open profile builder", "Enter profile details", "See validation errors", "Submit profile", "See the generated result".
- Not a user flow: internal execution such as onChange, debounce, POST /api/x, verifySession, rate limiting or model calls. Mention server work only as what the person experiences ("Wait while the summary is generated").
- Step labels are 2-6 plain words with no function, component, file or endpoint names.

Grounding
- Use only what the shown pages, components, layouts and handlers support. Validation, loading, error and success steps need visible source (a message, a disabled state, a redirect, a rendered result).
- Do not manufacture a conventional journey (sign up, log in, settings) because apps usually have one. If a step is not supported by what you were shown, leave it out.
- Return several flows only when the source shows genuinely different tasks, most important first, at most ${LIMITS.maxFlows}. Each flow has 2 to ${LIMITS.maxStepsPerFlow} steps.
- If the shown source contains no meaningful human-facing task, return no flows and say why in noFlowsReason. That is a correct answer.
- entryRoute must be a route from the discovered routes list, or null.

Evidence
- Each step cites the source lines that show it: path, startLine, endLine, optional symbol visible in those lines. A step may cite several ranges (for example the input, its validation message and the handler that produces the result).
- Use only files shown in <repository_file> blocks and only printed line numbers. Every line in a cited range must have been shown; ranges reaching into "[lines x-y not shown]" are rejected.
- Never output URLs.

Style: concise. The title is the person's goal. Keep explanations to one plain sentence or null.`

export function userFlowUserPrompt(context: string): string {
  return `${context}\n\nDescribe the user flows this application supports, using the schema. Cite only lines shown above.`
}
