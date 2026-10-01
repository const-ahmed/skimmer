import { describe, expect, it } from 'vitest'
import { ARCHITECTURE_PROFILE, USER_FLOW_PROFILE, selectExcerptRanges } from './excerpt'
import { isWithinRanges, renderNumberedLines, splitLines } from './lines'
import { renderFileBlock } from './render'

describe('line handling', () => {
  it('numbers lines the way GitHub does', () => {
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b'])
    expect(splitLines('')).toEqual([])
  })

  it('checks that a range lies entirely within shown ranges', () => {
    const shown = [{ start: 1, end: 8 }, { start: 9, end: 12 }, { start: 40, end: 50 }]
    expect(isWithinRanges({ start: 3, end: 12 }, shown)).toBe(true)
    expect(isWithinRanges({ start: 42, end: 44 }, shown)).toBe(true)
    expect(isWithinRanges({ start: 10, end: 41 }, shown)).toBe(false)
    expect(isWithinRanges({ start: 51, end: 51 }, shown)).toBe(false)
  })

  it('keeps original line numbers and states every omission', () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`)
    const rendered = renderNumberedLines(lines, [{ start: 1, end: 2 }, { start: 42, end: 43 }])
    expect(rendered.split('\n')).toEqual([
      ' 1 | line 1',
      ' 2 | line 2',
      '[lines 3-41 not shown]',
      '42 | line 42',
      '43 | line 43',
      '[lines 44-50 not shown]',
    ])
  })

  it('numbers a complete file from its real first line without omission markers', () => {
    const block = renderFileBlock({ path: 'a.ts', lines: ['x', 'y'], lineCount: 2 }, [{ start: 1, end: 2 }])
    expect(block).toBe('<repository_file path="a.ts" lines="2" shown="all">\n1 | x\n2 | y\n</repository_file>')
  })
})

describe('excerpt selection', () => {
  const longHandler = (target: string) => {
    const lines = Array.from({ length: 400 }, (_, index) => `const filler${index} = ${index};`)
    lines[42] = `  const session = await verifySession(request)`
    lines[43] = `  const result = await rateLimiter.limit(session.userId)`
    lines[300] = target
    return lines
  }

  it('returns the whole file when it fits', () => {
    expect(selectExcerptRanges(['a', 'b', 'c'], 10_000, ARCHITECTURE_PROFILE)).toEqual([{ start: 1, end: 3 }])
  })

  it('selects architecture-bearing windows deep in a file and keeps their real numbers', () => {
    const lines = longHandler('export async function POST(request) {')
    const ranges = selectExcerptRanges(lines, 3_000, ARCHITECTURE_PROFILE)
    expect(ranges[0]!.start).toBe(1)
    expect(isWithinRanges({ start: 43, end: 44 }, ranges)).toBe(true)
    expect(isWithinRanges({ start: 301, end: 301 }, ranges)).toBe(true)
    const rendered = renderNumberedLines(lines, ranges)
    expect(rendered).toContain(' 43 |   const session = await verifySession(request)')
    expect(rendered).toMatch(/\[lines \d+-\d+ not shown\]/)
  })

  it('stays within the character budget', () => {
    const lines = longHandler('export default function Page() {')
    for (const budget of [500, 2_000, 6_000]) {
      const ranges = selectExcerptRanges(lines, budget, ARCHITECTURE_PROFILE)
      expect(renderNumberedLines(lines, ranges).length).toBeLessThan(budget * 1.3)
    }
  })

  it('favours forms, inputs and feedback states for user flows', () => {
    const lines = Array.from({ length: 300 }, (_, index) => `const v${index} = compute(${index});`)
    lines[200] = '  <form onSubmit={handleSubmit}>'
    lines[205] = '  {errors.name && <p>{errors.name}</p>}'
    const ranges = selectExcerptRanges(lines, 2_000, USER_FLOW_PROFILE)
    expect(isWithinRanges({ start: 201, end: 206 }, ranges)).toBe(true)
  })
})
