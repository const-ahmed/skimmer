import { z } from 'zod'

// Keywords structured outputs rejects. Limits they would express are enforced
// by the domain schemas after the response instead.
const UNSUPPORTED = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'pattern',
])

type Json = Record<string, unknown>

/**
 * JSON Schema for `output_config.format`. Written here rather than using the
 * SDK's zodOutputFormat because that helper demotes `enum` to a description,
 * which would leave enum fields unenforced by the API.
 */
export function toStructuredSchema(schema: z.ZodType): Json {
  return clean(z.toJSONSchema(schema, { io: 'output' }) as Json)
}

function clean(node: Json): Json {
  const out: Json = {}
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED.has(key)) continue
    if (key === 'minItems' && typeof value === 'number' && value > 1) continue
    if (key === 'type' && Array.isArray(value)) {
      out.anyOf = value.map((type) => ({ type }))
      continue
    }
    if (key === 'properties' && isJson(value))
      out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, isJson(child) ? clean(child) : child]))
    else if ((key === 'items' || key === 'additionalProperties') && isJson(value)) out[key] = clean(value)
    else if ((key === 'anyOf' || key === 'allOf' || key === 'oneOf') && Array.isArray(value))
      out[key === 'oneOf' ? 'anyOf' : key] = value.map((child) => (isJson(child) ? clean(child) : child))
    else if ((key === '$defs' || key === 'definitions') && isJson(value))
      out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, isJson(child) ? clean(child) : child]))
    else out[key] = value
  }
  if (out.type === 'object') out.additionalProperties = false
  return out
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
