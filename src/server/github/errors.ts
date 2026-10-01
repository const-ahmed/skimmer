export type GitHubErrorCode =
  | 'REPOSITORY_NOT_FOUND'
  | 'REPOSITORY_NOT_PUBLIC'
  | 'REPOSITORY_EMPTY'
  | 'GITHUB_RATE_LIMITED'
  | 'GITHUB_TIMEOUT'
  | 'GITHUB_UNAVAILABLE'
  | 'GITHUB_INVALID_RESPONSE'

const PUBLIC_MESSAGES: Record<GitHubErrorCode, string> = {
  REPOSITORY_NOT_FOUND:
    'Repository not found. Check the owner and name; only public repositories are supported.',
  REPOSITORY_NOT_PUBLIC: 'Only public repositories can be analysed.',
  REPOSITORY_EMPTY: 'This repository has no commits or readable files yet.',
  GITHUB_RATE_LIMITED:
    'GitHub is temporarily limiting requests. Please try again in a minute.',
  GITHUB_TIMEOUT: 'GitHub took too long to respond. Please try again.',
  GITHUB_UNAVAILABLE: 'GitHub is temporarily unavailable. Please try again.',
  GITHUB_INVALID_RESPONSE: 'GitHub returned an unexpected response.',
}

const HTTP_STATUS: Record<GitHubErrorCode, number> = {
  REPOSITORY_NOT_FOUND: 404,
  REPOSITORY_NOT_PUBLIC: 403,
  REPOSITORY_EMPTY: 422,
  GITHUB_RATE_LIMITED: 429,
  GITHUB_TIMEOUT: 504,
  GITHUB_UNAVAILABLE: 503,
  GITHUB_INVALID_RESPONSE: 502,
}

/** Carries only an application-authored message; never an upstream body. */
export class GitHubError extends Error {
  readonly httpStatus: number

  constructor(
    readonly code: GitHubErrorCode,
    readonly upstreamStatus?: number,
  ) {
    super(PUBLIC_MESSAGES[code])
    this.name = 'GitHubError'
    this.httpStatus = HTTP_STATUS[code]
  }
}
