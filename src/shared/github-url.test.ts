import { describe, expect, it } from 'vitest'
import { parseGitHubRepository } from './github-url'

describe('parseGitHubRepository', () => {
  it.each([
    ['https://github.com/vercel/next.js', 'vercel', 'next.js'],
    ['facebook/react', 'facebook', 'react'],
    ['  vercel/next.js  ', 'vercel', 'next.js'],
    ['https://github.com/vercel/next.js.git', 'vercel', 'next.js'],
    ['vercel/next.js.git', 'vercel', 'next.js'],
    ['owner/x.git.git', 'owner', 'x.git'],
    ['owner/.git', 'owner', '.git'],
    ['HTTPS://GitHub.com/vercel/next.js', 'vercel', 'next.js'],
    ['git@github.com:vercel/next.js.git', 'vercel', 'next.js'],
    ['ssh://git@github.com/vercel/next.js', 'vercel', 'next.js'],
  ])('parses %s', (input, owner, repo) => {
    expect(parseGitHubRepository(input)).toEqual({ owner, repo })
  })

  it.each([
    'https://github.com/vercel/next.js/',
    'https://github.com/vercel/next.js/tree/canary/packages/next',
    'https://github.com/vercel/next.js/blob/canary/README.md',
    'https://github.com/vercel/next.js/pull/456/files',
    'https://github.com/vercel/next.js?tab=readme-ov-file',
    'https://github.com/vercel/next.js#readme',
    'https://www.github.com/vercel/next.js',
  ])('resolves deep link %s to the repository', (input) => {
    expect(parseGitHubRepository(input)).toEqual({ owner: 'vercel', repo: 'next.js' })
  })

  it.each([
    'https://gitlab.com/vercel/next.js',
    'not-a-url',
    'https://github.com/vercel',
    'https://github.com/',
    'https://github.com/vercel//next.js',
    'https://github.com.evil.com/vercel/next.js',
    'https://evil.com/github.com/vercel/next.js',
    'owner/..',
    '-owner/repo',
    'owner-/repo',
    'own--er/repo',
    `${'a'.repeat(40)}/repo`,
    'owner/re po',
    'owner/repo%2F..',
    `https://github.com/owner/${'r'.repeat(300)}`,
  ])('rejects %s', (input) => {
    expect(parseGitHubRepository(input)).toBeNull()
  })
})
