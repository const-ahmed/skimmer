import { REPOSITORY_LIMITS } from '@/server/analysis/limits'
import { isArchitectureSource, isManifestPath } from './paths'
import type { TreeEntry } from './types'

const BARREL = /(?:^|\/)(?:index|mod|__init__)\.[^/]+$/i

export function scoreArchitecturePath(path: string): number {
  const name = path.split('/').at(-1) ?? path
  const depth = path.split('/').length
  let value = 20 - depth
  if (isManifestPath(path)) value += path.includes('/') ? 5 : 45
  if (/^(?:main|apps?|server|applications?|Program|worker|cli)\./i.test(name)) value += 28
  // File-based frameworks keep the request boundary in singular route files.
  if (/^(?:route|\+server|\+page\.server)\.[cm]?[jt]sx?$/i.test(name)) value += 32
  if (/page-client\.[cm]?[jt]sx?$/i.test(name)) value += 22
  if (/^(?:page|\+page)\.(?:[jt]sx|svelte)$/i.test(name)) value += 16
  if (/^use[A-Z].*\.[cm]?[jt]sx?$/.test(name)) value += 22
  if (/^(?:index|lib|mod)\./i.test(name)) value += depth <= 3 ? 22 : 2
  if (/(?:controller|manager|routes|query|ingest|search|auth|parser|context|session|templating)/i.test(name))
    value += 10
  if (
    /(?:webhook|router|routes|routing|handler|controller|tasks|worker|pipeline|engine|manager|repository|storage|database|client|service|middleware|scheduler|queue)/i.test(
      name,
    )
  )
    value += 22
  if (/(?:pipeline|engine|orchestrat|review|retriev|embedding|inference|llm|rag|query|ingest)/i.test(name))
    value += 18
  if (/(?:config|types|constants|utils|helpers|schema|models)/i.test(name)) value -= 6
  if (/(?:analytics|telemetry|instrumentation|logger|logging)/i.test(name)) value -= 25
  if (/(?:^|\/)(?:healthz?|readyz?|livez?)(?:\/|\.)/i.test(path)) value -= 30
  if (/(?:^|\/)scripts?\//i.test(path)) value -= 35
  if (/^(?:testclient|conftest)\./i.test(name)) value -= 35
  if (/(?:activity|service)\.(?:kt|java)$/i.test(name)) value += 18
  if (/^I[A-Z].*\.(?:java|kt|cs)$/.test(name)) value -= 20
  return value
}

interface Candidate {
  path: string
  directory: string
  /** First two directory segments: sibling route folders share one. */
  area: string
  base: number
  manifest: boolean
}

// A soft diversity penalty keeps another subsystem's entry point ahead of a folder full of helpers.
export function rankArchitecturePaths(
  entries: ReadonlyMap<string, TreeEntry>,
  limit: number,
): string[] {
  const candidates: Candidate[] = []
  for (const entry of entries.values()) {
    if (
      entry.type !== 'blob' ||
      !isArchitectureSource(entry.path) ||
      (entry.size !== undefined && entry.size > REPOSITORY_LIMITS.maxSourceFileBytes)
    )
      continue
    const size = entry.size
    const directory = entry.path.includes('/')
      ? entry.path.slice(0, entry.path.lastIndexOf('/'))
      : ''
    candidates.push({
      path: entry.path,
      directory,
      area: directory.split('/').slice(0, 2).join('/'),
      base:
        scoreArchitecturePath(entry.path) -
        // Empty barrels and tiny wrappers should not crowd out real modules.
        (size !== undefined && size < 250 ? 15 : 0) -
        (size !== undefined && size < 2000 && BARREL.test(entry.path) ? 18 : 0) +
        Math.min(10, Math.log2(1 + (size ?? 0) / 1000)),
      manifest: isManifestPath(entry.path),
    })
  }

  const priorities = candidates.map((candidate) => candidate.base)
  const groups = new Map<string, number[]>()
  candidates.forEach((candidate, index) => {
    for (const key of [`d:${candidate.directory}`, `a:${candidate.area}`]) {
      const members = groups.get(key)
      if (members) members.push(index)
      else groups.set(key, [index])
    }
  })
  const directories = new Map<string, number>()
  const areas = new Map<string, number>()
  const taken = new Uint8Array(candidates.length)
  const selected: string[] = []
  let manifests = 0

  while (selected.length < limit) {
    let best = -1
    for (let index = 0; index < candidates.length; index++) {
      if (taken[index] || (candidates[index]!.manifest && manifests >= 1)) continue
      if (best === -1 || ranksAhead(index, best)) best = index
    }
    if (best === -1) break
    const picked = candidates[best]!
    taken[best] = 1
    selected.push(picked.path)
    directories.set(picked.directory, (directories.get(picked.directory) ?? 0) + 1)
    areas.set(picked.area, (areas.get(picked.area) ?? 0) + 1)
    if (picked.manifest) manifests++
    for (const key of [`d:${picked.directory}`, `a:${picked.area}`])
      for (const index of groups.get(key) ?? []) {
        const candidate = candidates[index]!
        priorities[index] =
          candidate.base -
          5 * (directories.get(candidate.directory) ?? 0) -
          3 * (areas.get(candidate.area) ?? 0)
      }
  }
  return selected

  function ranksAhead(a: number, b: number): boolean {
    if (priorities[a] !== priorities[b]) return priorities[a]! > priorities[b]!
    return candidates[a]!.path.localeCompare(candidates[b]!.path) < 0
  }
}
