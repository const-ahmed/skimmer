import type { z } from 'zod'
import { GITHUB_LIMITS } from '@/server/analysis/limits'
import { GitHubError } from './errors'

const API_ORIGIN = 'https://api.github.com'
const RAW_ORIGIN = 'https://raw.githubusercontent.com'

export type Fetch = typeof fetch

export interface GitHubClient {
  /** `segments` are encoded individually; callers never build URLs. */
  getJson<T>(
    segments: string[],
    schema: z.ZodType<T>,
    options?: { query?: Record<string, string> },
  ): Promise<T>
  getCommitSha(owner: string, repo: string, ref: string): Promise<string>
  /** Raw file bytes at an exact commit, or null when unavailable or over `maxBytes`. */
  getRawFile(
    owner: string,
    repo: string,
    commitSha: string,
    path: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Uint8Array | null>
}

export function createGitHubClient(options: {
  token?: string
  signal: AbortSignal
  fetch?: Fetch
}): GitHubClient {
  const doFetch = options.fetch ?? fetch
  const apiHeaders = (accept: string): HeadersInit => ({
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'visualise',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  })

  const request = async (
    segments: string[],
    accept: string,
    query?: Record<string, string>,
  ): Promise<Response> => {
    const url = new URL(
      `${API_ORIGIN}/${segments.map(encodeURIComponent).join('/')}`,
    )
    for (const [key, value] of Object.entries(query ?? {}))
      url.searchParams.set(key, value)
    const timeout = AbortSignal.timeout(GITHUB_LIMITS.requestTimeoutMs)
    let response: Response
    try {
      response = await doFetch(url, {
        headers: apiHeaders(accept),
        // Workers support only follow/manual; a redirect is never followed.
        redirect: 'manual',
        signal: AbortSignal.any([options.signal, timeout]),
      })
    } catch (error) {
      options.signal.throwIfAborted()
      if (timeout.aborted) throw new GitHubError('GITHUB_TIMEOUT')
      console.warn(JSON.stringify({ event: 'github.fetch_failed', name: error instanceof Error ? error.name : typeof error }))
      throw new GitHubError('GITHUB_UNAVAILABLE')
    }
    if (response.ok) return response
    await response.body?.cancel()
    throw classifyFailure(response)
  }

  return {
    async getJson(segments, schema, requestOptions) {
      const response = await request(
        segments,
        'application/vnd.github+json',
        requestOptions?.query,
      )
      const parsed = schema.safeParse(await response.json().catch(() => null))
      if (!parsed.success) throw new GitHubError('GITHUB_INVALID_RESPONSE')
      return parsed.data
    },

    async getCommitSha(owner, repo, ref) {
      const response = await request(
        ['repos', owner, repo, 'commits', ref],
        'application/vnd.github.sha',
      )
      const sha = (await response.text()).trim()
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha))
        throw new GitHubError('GITHUB_INVALID_RESPONSE')
      return sha
    },

    async getRawFile(owner, repo, commitSha, path, maxBytes, signal) {
      // No credentials go to the raw host; it serves public content only.
      const url = `${RAW_ORIGIN}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commitSha}/${path.split('/').map(encodeURIComponent).join('/')}`
      const timeout = AbortSignal.timeout(GITHUB_LIMITS.requestTimeoutMs)
      try {
        const response = await doFetch(url, {
          headers: { 'User-Agent': 'visualise' },
          redirect: 'manual',
          signal: AbortSignal.any([signal, timeout]),
        })
        return await readBounded(response, maxBytes)
      } catch {
        signal.throwIfAborted()
        return null
      }
    },
  }
}

function classifyFailure(response: Response): GitHubError {
  const status = response.status
  // Logged without the body: it can describe the server's own token.
  console.warn(
    JSON.stringify({
      event: 'github.request_failed',
      status,
      requestId: response.headers.get('x-github-request-id'),
      rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
    }),
  )
  // 3xx: renamed or transferred repositories. Redirects are not followed.
  if (status === 404 || (status >= 300 && status < 400)) return new GitHubError('REPOSITORY_NOT_FOUND', status)
  // Empty repositories answer 409 on commits and trees.
  if (status === 409) return new GitHubError('REPOSITORY_EMPTY', status)
  if (
    status === 429 ||
    (status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after')))
  )
    return new GitHubError('GITHUB_RATE_LIMITED', status)
  if (status === 403 || status === 401 || status === 451)
    return new GitHubError('REPOSITORY_NOT_FOUND', status)
  return new GitHubError('GITHUB_UNAVAILABLE', status)
}

async function readBounded(
  response: Response,
  limit: number,
): Promise<Uint8Array | null> {
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    return null
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    await response.body.cancel()
    return null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
