export interface RepositoryRef {
  owner: string
  repo: string
}

// GitHub owners: 1-39 alphanumerics or single hyphens, not at either end.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

const HTTPS_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([^/?#\s]+)\/([^/?#\s]+)(?:[/?#][^\s]*)?$/i
const SSH_URL = /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)\/?$/i
const SHORTHAND = /^([^/\s]+)\/([^/\s]+)$/

export const MAX_REPOSITORY_INPUT_LENGTH = 300

function stripGitSuffix(repo: string): string {
  return repo.length > 4 && repo.toLowerCase().endsWith('.git')
    ? repo.slice(0, -4)
    : repo
}

// Also accepts deep links, SSH remotes and owner/repo shorthand.
export function parseGitHubRepository(input: string): RepositoryRef | null {
  const value = input.trim()
  if (!value || value.length > MAX_REPOSITORY_INPUT_LENGTH) return null
  const match =
    HTTPS_URL.exec(value) ?? SSH_URL.exec(value) ?? SHORTHAND.exec(value)
  if (!match?.[1] || !match[2]) return null
  const owner = match[1]
  const repo = stripGitSuffix(match[2])
  if (!OWNER.test(owner) || !REPO.test(repo)) return null
  if (repo === '.' || repo === '..') return null
  return { owner, repo }
}
