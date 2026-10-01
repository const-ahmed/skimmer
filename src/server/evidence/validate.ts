import { isWithinRanges } from '@/server/repository/lines'
import type { Evidence, ModelEvidence } from './schema'
import type { EvidenceScope } from './scope'

export type EvidenceRejection =
  | 'malformed-path'
  | 'unknown-path'
  | 'not-shown'
  | 'invalid-range'
  | 'outside-file'
  | 'outside-shown-lines'

export type EvidenceCheck =
  | { ok: true; evidence: Evidence }
  | { ok: false; reason: EvidenceRejection; path: string }

/**
 * Normalises harmless formatting ("./a.ts", "/a.ts"). Anything that looks
 * like a URL, escapes the root or is not a plain relative path is rejected.
 */
export function normaliseCitedPath(raw: string): string | null {
  let path = raw.trim()
  if (!path || path.length > 1024) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return null
  if (/[\u0000-\u001f\\#?]/.test(path)) return null
  path = path.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..'))
    return null
  return path
}

/**
 * Enforces provenance, not truth: the path exists at the analysed commit, was
 * shown to this analysis, and every cited line was among the lines shown. A
 * range reaching into lines the model never saw is rejected, never clamped.
 */
export function checkEvidence(raw: ModelEvidence, scope: EvidenceScope): EvidenceCheck {
  const path = normaliseCitedPath(raw.path)
  if (!path) return { ok: false, reason: 'malformed-path', path: raw.path }
  const file = scope.files.get(path)
  if (!file)
    return {
      ok: false,
      reason: scope.repositoryPaths.has(path) ? 'not-shown' : 'unknown-path',
      path,
    }
  const { startLine, endLine } = raw
  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    startLine > endLine
  )
    return { ok: false, reason: 'invalid-range', path }
  if (endLine > file.lineCount) return { ok: false, reason: 'outside-file', path }
  if (!isWithinRanges({ start: startLine, end: endLine }, file.ranges))
    return { ok: false, reason: 'outside-shown-lines', path }

  const evidence: Evidence = { path, startLine, endLine, origin: 'model' }
  const symbol = verifiedSymbol(raw.symbol, file.lines, startLine, endLine)
  if (symbol) evidence.symbol = symbol
  return { ok: true, evidence }
}

/** A symbol is kept only when it is an identifier that appears in the cited lines. */
function verifiedSymbol(
  symbol: string | null,
  lines: readonly string[],
  startLine: number,
  endLine: number,
): string | null {
  const name = symbol?.trim()
  if (!name || name.length > 120 || !/^[A-Za-z_$][\w$.:#-]*$/.test(name)) return null
  const cited = lines.slice(startLine - 1, endLine).join('\n')
  const last = name.split(/[.:#]+/).at(-1)!
  return cited.includes(last) ? name : null
}

export interface EvidenceOutcome {
  accepted: Evidence[]
  rejected: Array<{ path: string; reason: EvidenceRejection }>
}

export function checkEvidenceList(
  list: readonly ModelEvidence[],
  scope: EvidenceScope,
): EvidenceOutcome {
  const accepted: Evidence[] = []
  const rejected: EvidenceOutcome['rejected'] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const check = checkEvidence(raw, scope)
    if (!check.ok) {
      rejected.push({ path: check.path, reason: check.reason })
      continue
    }
    const key = `${check.evidence.path}:${check.evidence.startLine}-${check.evidence.endLine}`
    if (seen.has(key)) continue
    seen.add(key)
    accepted.push(check.evidence)
  }
  return { accepted, rejected }
}
