import type { ShownFile } from '@/server/evidence/scope'
import { formatRanges, renderNumberedLines, renderedLineCost } from './lines'
import type { LineRange, SourceFile } from './types'

/**
 * Repository content is wrapped in <repository_file> blocks. Every content
 * line carries a "N | " prefix, so text inside a file can never pass itself
 * off as a block boundary or as application-generated context.
 */
export function renderFileBlock(
  file: Pick<SourceFile, 'path' | 'lines' | 'lineCount'>,
  ranges: readonly LineRange[],
  role?: string,
): string {
  const complete =
    ranges.length === 1 && ranges[0]!.start === 1 && ranges[0]!.end === file.lineCount
  const attributes = [
    `path=${JSON.stringify(file.path)}`,
    `lines="${file.lineCount}"`,
    `shown="${complete ? 'all' : formatRanges(ranges)}"`,
    ...(role ? [`role=${JSON.stringify(role)}`] : []),
  ].join(' ')
  return `<repository_file ${attributes}>\n${renderNumberedLines(file.lines, ranges)}\n</repository_file>`
}

export function readmeRanges(lines: readonly string[], budget: number): LineRange[] {
  let used = 0
  let end = 0
  for (const line of lines) {
    const cost = renderedLineCost(line, lines.length)
    if (used + cost > budget) break
    used += cost
    end++
  }
  return end ? [{ start: 1, end }] : []
}

export function shownFile(
  file: Pick<SourceFile, 'path' | 'lines' | 'lineCount'>,
  ranges: LineRange[],
  kind: ShownFile['kind'],
): ShownFile {
  return { path: file.path, lineCount: file.lineCount, ranges, lines: file.lines, kind }
}

/** Fair per-file character budgets: small files take what they need, the rest share. */
export function allocateBudgets(
  costs: readonly number[],
  total: number,
  perFileCap: number,
): number[] {
  const limits = costs.map(() => 0)
  let remaining = Math.max(0, total)
  let pending = costs.map((_, index) => index)
  while (pending.length && remaining > 0) {
    const share = Math.floor(remaining / pending.length)
    if (!share) break
    const next: number[] = []
    for (const index of pending) {
      const want = Math.min(costs[index]!, perFileCap) - limits[index]!
      const allocation = Math.min(share, want)
      limits[index]! += allocation
      remaining -= allocation
      if (limits[index]! < Math.min(costs[index]!, perFileCap)) next.push(index)
    }
    pending = next
  }
  return limits
}

export function renderedCost(lines: readonly string[]): number {
  return lines.reduce((sum, line) => sum + renderedLineCost(line, lines.length), 0)
}

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return 'size unknown'
  return bytes < 10_000
    ? `${Math.max(0.1, Math.round(bytes / 100) / 10)} KB`
    : `${Math.round(bytes / 1000)} KB`
}
