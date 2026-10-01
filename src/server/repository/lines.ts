import type { LineRange } from './types'

/** Lines as GitHub numbers them: CRLF tolerated, a final newline adds no line. */
export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

export function createLineLocator(text: string): (offset: number) => number {
  const starts = [0]
  for (let index = 0; index < text.length; index++)
    if (text.charCodeAt(index) === 10) starts.push(index + 1)
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
}

export function rangesFromLines(lineNumbers: Iterable<number>): LineRange[] {
  const sorted = [...new Set(lineNumbers)].sort((a, b) => a - b)
  const ranges: LineRange[] = []
  for (const line of sorted) {
    const last = ranges.at(-1)
    if (last && line === last.end + 1) last.end = line
    else ranges.push({ start: line, end: line })
  }
  return ranges
}

export function formatRanges(ranges: readonly LineRange[]): string {
  return ranges
    .map((range) =>
      range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`,
    )
    .join(',')
}

export function isWithinRanges(
  range: LineRange,
  shown: readonly LineRange[],
): boolean {
  let cursor = range.start
  for (const span of shown) {
    if (span.end < cursor) continue
    if (span.start > cursor) return false
    cursor = span.end + 1
    if (cursor > range.end) return true
  }
  return false
}

/** Longer lines are cut when rendered; their number and start stay exact. */
export const MAX_RENDERED_LINE_CHARACTERS = 400

export function renderedLineCost(line: string, lineCount: number): number {
  return Math.min(line.length, MAX_RENDERED_LINE_CHARACTERS + 20) + String(lineCount).length + 4
}

function renderLine(line: string): string {
  return line.length > MAX_RENDERED_LINE_CHARACTERS
    ? `${line.slice(0, MAX_RENDERED_LINE_CHARACTERS)} [line truncated]`
    : line
}

/**
 * Renders lines with their original numbers. Omitted stretches are stated
 * explicitly so absence in the excerpt is never mistaken for absence in the file.
 */
export function renderNumberedLines(
  lines: readonly string[],
  ranges: readonly LineRange[],
): string {
  const width = String(lines.length).length
  const out: string[] = []
  let next = 1
  for (const range of ranges) {
    if (range.start > next)
      out.push(`[lines ${next}-${range.start - 1} not shown]`)
    for (let line = range.start; line <= range.end; line++)
      out.push(`${String(line).padStart(width)} | ${renderLine(lines[line - 1] ?? '')}`)
    next = range.end + 1
  }
  if (next <= lines.length)
    out.push(`[lines ${next}-${lines.length} not shown]`)
  return out.join('\n')
}
