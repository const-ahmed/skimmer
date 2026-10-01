import { z } from 'zod'
import { GITHUB_LIMITS, REPOSITORY_LIMITS } from '@/server/analysis/limits'
import { isIgnoredPath, isSensitivePath } from '@/server/repository/paths'
import type {
  RepositorySnapshot,
  SkippedEntry,
  TreeEntry,
} from '@/server/repository/types'
import type { RepositoryRef } from '@/shared/github-url'
import type { GitHubClient } from './client'
import { GitHubError } from './errors'

const GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

const repositorySchema = z.object({
  default_branch: z.string().min(1).max(255),
  private: z.boolean(),
  visibility: z.string().optional(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  topics: z.array(z.string()).optional(),
})

const treeItemSchema = z.object({
  path: z.string(),
  mode: z.string(),
  type: z.string(),
  sha: z.string(),
  size: z.number().int().nonnegative().optional(),
})

const treeSchema = z.object({
  sha: z.string(),
  tree: z.array(treeItemSchema),
  truncated: z.boolean().optional(),
})

export type RawTreeItem = z.infer<typeof treeItemSchema>

/**
 * Resolves the default branch to one commit SHA and reads that commit's tree.
 * Everything downstream reads by this SHA, so a push during the analysis
 * cannot mix two repository versions.
 */
export async function resolveSnapshot(
  ref: RepositoryRef,
  client: GitHubClient,
): Promise<RepositorySnapshot> {
  const metadata = await client.getJson(
    ['repos', ref.owner, ref.repo],
    repositorySchema,
  )
  if (metadata.private || (metadata.visibility && metadata.visibility !== 'public'))
    throw new GitHubError('REPOSITORY_NOT_PUBLIC')

  const commitSha = await client.getCommitSha(
    ref.owner,
    ref.repo,
    metadata.default_branch,
  )
  const listing = await client.getJson(
    ['repos', ref.owner, ref.repo, 'git', 'trees', commitSha],
    treeSchema,
    { query: { recursive: '1' } },
  )
  const truncated = listing.truncated === true
  const items = truncated
    ? [...listing.tree, ...(await fillTruncatedTree(ref, client, listing))]
    : listing.tree

  const { entries, skipped } = buildEntries(items)
  if (![...entries.values()].some((entry) => entry.type === 'blob'))
    throw new GitHubError('REPOSITORY_EMPTY')

  return {
    identity: {
      owner: ref.owner,
      repo: ref.repo,
      defaultBranch: metadata.default_branch,
      commitSha,
    },
    metadata: {
      description: metadata.description ?? null,
      primaryLanguage: metadata.language ?? null,
      topics: metadata.topics ?? [],
    },
    entries,
    skipped,
    treeTruncated: truncated,
    listedEntryCount: items.length,
  }
}

/**
 * GitHub truncates recursive listings above 100,000 entries or 7 MB, which can
 * leave whole top-level folders out. Folders with nothing listed are read by
 * their own tree SHA (immutable, so still the same commit). Best effort.
 */
async function fillTruncatedTree(
  ref: RepositoryRef,
  client: GitHubClient,
  listing: z.infer<typeof treeSchema>,
): Promise<RawTreeItem[]> {
  const foldersWithContent = new Set<string>()
  for (const item of listing.tree) {
    const slash = item.path.indexOf('/')
    if (slash > 0) foldersWithContent.add(item.path.slice(0, slash))
  }
  const missing = listing.tree
    .filter(
      (item) =>
        item.type === 'tree' &&
        !item.path.includes('/') &&
        GIT_SHA.test(item.sha) &&
        !isIgnoredPath(item.path) &&
        !foldersWithContent.has(item.path),
    )
    .slice(0, GITHUB_LIMITS.maxTruncatedFolderFetches)
  const results = await Promise.all(
    missing.map(async (folder) => {
      try {
        const subtree = await client.getJson(
          ['repos', ref.owner, ref.repo, 'git', 'trees', folder.sha],
          treeSchema,
          { query: { recursive: '1' } },
        )
        return subtree.tree.map((item) => ({
          ...item,
          path: `${folder.path}/${item.path}`,
        }))
      } catch (error) {
        if (error instanceof GitHubError && error.code === 'GITHUB_RATE_LIMITED')
          throw error
        return []
      }
    }),
  )
  return results.flat()
}

export function buildEntries(items: readonly RawTreeItem[]): {
  entries: Map<string, TreeEntry>
  skipped: SkippedEntry[]
} {
  const entries = new Map<string, TreeEntry>()
  const skipped: SkippedEntry[] = []
  const skip = (entry: SkippedEntry) => {
    if (skipped.length < REPOSITORY_LIMITS.maxSkippedEntriesReported)
      skipped.push(entry)
  }
  for (const item of items) {
    if (!isSafeRepositoryPath(item.path) || entries.has(item.path)) continue
    if (isIgnoredPath(item.path)) continue
    if (item.type === 'commit' || item.mode === '160000') {
      skip({ path: item.path, reason: 'submodule' })
      continue
    }
    if (item.mode === '120000') {
      skip({ path: item.path, reason: 'symlink' })
      continue
    }
    if (!GIT_SHA.test(item.sha)) continue
    if (item.type === 'tree') {
      entries.set(item.path, { path: item.path, type: 'tree', sha: item.sha })
      continue
    }
    if (item.type !== 'blob' || (item.mode !== '100644' && item.mode !== '100755'))
      continue
    if (isSensitivePath(item.path)) {
      skip({ path: item.path, reason: 'sensitive' })
      continue
    }
    entries.set(item.path, {
      path: item.path,
      type: 'blob',
      sha: item.sha,
      size: item.size,
    })
  }
  return { entries, skipped }
}

function isSafeRepositoryPath(path: string): boolean {
  if (!path || path.length > 1024 || path.startsWith('/')) return false
  // Angle brackets could forge prompt block boundaries in tree listings.
  if (/[\u0000-\u001f\u007f\\<>]/.test(path)) return false
  return path.split('/').every((part) => part && part !== '.' && part !== '..')
}
