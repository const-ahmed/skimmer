/** Single-line display text: NFC, no control characters, collapsed whitespace. */
export function normaliseText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
  return /^[a-z]/.test(slug) ? slug : slug ? `n-${slug}`.slice(0, 64) : ''
}

/** Shortens at a word boundary; reports whether anything was cut. */
export function shorten(value: string, max: number): { text: string; cut: boolean } {
  if (value.length <= max) return { text: value, cut: false }
  const slice = value.slice(0, max - 1)
  const boundary = slice.lastIndexOf(' ')
  return { text: `${(boundary > max / 2 ? slice.slice(0, boundary) : slice).trimEnd()}…`, cut: true }
}

/** Model prose must not carry links; the application builds all links. */
export function containsUrl(value: string): boolean {
  return /\b(?:https?|ftp|file|data|javascript):|\bwww\./i.test(value)
}

export function stripUrls(value: string): string {
  return value
    .replace(/\b(?:https?|ftp|file|data|javascript):[^\s)]*/gi, '[link removed]')
    .replace(/\bwww\.[^\s)]*/gi, '[link removed]')
}
