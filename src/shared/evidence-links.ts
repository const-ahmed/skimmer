interface RepositoryAt {
  owner: string
  repo: string
  commitSha: string
}

function base(repository: RepositoryAt, kind: 'blob' | 'tree', path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/${kind}/${repository.commitSha}/${encodedPath}`
}

/** Builds an exact, commit-pinned GitHub file link. Only the application builds links. */
export function githubBlobUrl(params: RepositoryAt & { path: string; startLine?: number; endLine?: number }): string {
  const url = base(params, 'blob', params.path)
  if (params.startLine === undefined) return url
  const end = params.endLine ?? params.startLine
  return end === params.startLine ? `${url}#L${params.startLine}` : `${url}#L${params.startLine}-L${end}`
}

export function githubTreeUrl(params: RepositoryAt & { path: string }): string {
  return base(params, 'tree', params.path)
}
