// Ranges stay in the file's own line numbers, so every excerpt line keeps its real number.

import type { LineRange } from './types'
import { rangesFromLines, renderedLineCost } from './lines'

export interface ExcerptSignal {
  pattern: RegExp
  before: number
  after: number
  score: number
}

export interface ExcerptProfile {
  signals: readonly ExcerptSignal[]
  importedCalls: boolean
}

export const ARCHITECTURE_PROFILE: ExcerptProfile = {
  importedCalls: true,
  signals: [
    {
      pattern:
        /(?:constructor\s*\(|\b(?:onCreate|__init__|main|setup|initialize|wsgi_app|dispatch_request|handle_request|ServeHTTP|create_app|POST|GET|PUT|DELETE|PATCH)\s*\(|func\s+New\w*\s*\(|\bexport\s+(?:default\s+)?(?:async\s+)?function\b|\bcreateServerFn\b|\bapp\.(?:get|post|put|delete|use)\s*\()/i,
      before: 2,
      after: 14,
      score: 90,
    },
    {
      pattern:
        /(?:\bnew\s+[A-Z]\w*|\bawait\s+|\.\s*(?:run|start|connect|register|dispatch|include|query|execute|invoke|create|index|retrieve|fetch|publish|send|add|use|mount)\w*\s*\()/i,
      before: 2,
      after: 5,
      score: 50,
    },
  ],
}

export const USER_FLOW_PROFILE: ExcerptProfile = {
  importedCalls: true,
  signals: [
    {
      pattern:
        /<(?:form|Form)\b|\bonSubmit\b|\bhandleSubmit\b|\buseForm\b|\baction=|\bformAction\b|\bmethod=["']post/i,
      before: 3,
      after: 16,
      score: 120,
    },
    {
      pattern:
        /<(?:input|Input|textarea|Textarea|select|Select|button|Button|Checkbox|Switch|RadioGroup|Dialog|Modal)\b|\bonClick\b|\bonChange\b|\bv-model\b|\bbind:value\b|@click\b/,
      before: 2,
      after: 6,
      score: 90,
    },
    {
      pattern:
        /\b(?:navigate|redirect|router\.push|router\.replace|useNavigate|href=|to=|goto)\b|<(?:Link|a|NuxtLink|RouterLink)\b/,
      before: 1,
      after: 4,
      score: 80,
    },
    {
      pattern:
        /\b(?:isLoading|loading|isPending|pending|isSubmitting|submitting|error|errors|isError|success|isSuccess|toast|alert|disabled|required|validate|validation|safeParse|zodResolver|setError)\b/i,
      before: 1,
      after: 4,
      score: 70,
    },
    {
      pattern:
        /\bexport\s+(?:default\s+)?(?:async\s+)?function\b|\bcreateFileRoute\b|\bexport\s+const\s+(?:loader|action)\b|\bfetch\s*\(|\buseMutation\b|\buseQuery\b/,
      before: 1,
      after: 8,
      score: 75,
    },
  ],
}

interface Window {
  start: number
  end: number
  score: number
}

const REGIONS = 8
const SAMPLE_SCORE = 10

// The opening lines come first, then scored windows spread across the file so
// one region cannot use the whole budget.
export function selectExcerptRanges(
  lines: readonly string[],
  budget: number,
  profile: ExcerptProfile,
): LineRange[] {
  const lineCost = (index: number) => renderedLineCost(lines[index]!, lines.length)
  const total = lines.reduce((sum, _, index) => sum + lineCost(index), 0)
  if (total <= budget)
    return lines.length ? [{ start: 1, end: lines.length }] : []

  const importedNames = profile.importedCalls ? collectImportedNames(lines) : new Set<string>()
  const windows: Window[] = [{ start: 0, end: Math.min(8, lines.length), score: 100 }]
  lines.forEach((line, index) => {
    for (const signal of profile.signals)
      if (signal.pattern.test(line)) {
        windows.push({
          start: Math.max(0, index - signal.before),
          end: Math.min(lines.length, index + signal.after),
          score: signal.score,
        })
        return
      }
    if (importedNames.size && callsImported(line, importedNames))
      windows.push({
        start: Math.max(0, index - 1),
        end: Math.min(lines.length, index + 7),
        score: 85,
      })
  })
  // Sample across the file where nothing is recognisable, rather than
  // pretending the unsampled body was inspected.
  for (let index = 0; index < lines.length; index += 30)
    windows.push({ start: index, end: Math.min(lines.length, index + 20), score: SAMPLE_SCORE })

  const regionFor = (start: number) =>
    Math.min(REGIONS - 1, Math.floor((start / lines.length) * REGIONS))
  const buckets = Array.from({ length: REGIONS }, () => [] as Window[])
  for (const window of windows) buckets[regionFor(window.start)]!.push(window)
  for (const bucket of buckets) bucket.sort((a, b) => b.score - a.score || a.start - b.start)

  const selected = new Set<number>()
  const regionPicks = new Array<number>(REGIONS).fill(0)
  const cursors = new Array<number>(REGIONS).fill(0)
  let used = 0
  while (true) {
    let bestRegion = -1
    let bestPriority = -Infinity
    for (let region = 0; region < REGIONS; region++) {
      const candidate = buckets[region]![cursors[region]!]
      if (!candidate) continue
      // Sampling windows only fill space left after every recognised window.
      const priority =
        candidate.score > SAMPLE_SCORE
          ? candidate.score - 45 * regionPicks[region]!
          : candidate.score - 1_000 - regionPicks[region]!
      if (priority > bestPriority) {
        bestRegion = region
        bestPriority = priority
      }
    }
    if (bestRegion === -1) break
    const window = buckets[bestRegion]![cursors[bestRegion]!]!
    cursors[bestRegion]!++
    const missing: number[] = []
    for (let index = window.start; index < window.end; index++)
      if (!selected.has(index)) missing.push(index)
    if (!missing.length) continue
    // Plus room for the "[lines x-y not shown]" marker a new window may add.
    const cost = missing.reduce((sum, index) => sum + lineCost(index), 0) + 32
    if (used + cost > budget) continue
    for (const index of missing) selected.add(index)
    used += cost
    regionPicks[bestRegion]!++
  }
  return rangesFromLines([...selected].map((index) => index + 1))
}

function collectImportedNames(lines: readonly string[]): Set<string> {
  const names = new Set<string>()
  const text = lines.join('\n')
  for (const match of text.matchAll(/^[\t ]*import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/gm))
    for (const entry of match[1]!.split(',')) {
      if (/^\s*type\s/.test(entry)) continue
      const name = entry.trim().split(/\s+as\s+/).at(-1)
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  for (const match of text.matchAll(/^[\t ]*import\s+([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/gm))
    names.add(match[1]!)
  return names
}

function callsImported(line: string, names: ReadonlySet<string>): boolean {
  for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(|<([A-Z][\w$]*)(?=[\s/>])/g))
    if (names.has(match[1] ?? match[2]!)) return true
  return false
}
