import { describe, expect, it } from 'vitest'
import type { EvidenceScope } from '@/server/evidence/scope'
import { snapshotOf, storeOf } from '@/test/fixtures'
import { buildUserFlowContext } from './retrieval'
import type { UserFlowWire } from './schema'
import { detectUiSurface, matchEndpoint } from './surface'
import { finaliseUserFlows, looksLikeCode } from './validate'

const NEXT_MANIFEST = '{"dependencies":{"next":"15","react":"19"}}'

const PAGE = [
  'import { ProfileForm } from "@/components/ProfileForm"',
  'export default function Page() {',
  '  return <ProfileForm />',
  '}',
].join('\n')

const FORM = [
  '"use client"',
  'import { useState } from "react"',
  'export function ProfileForm() {',
  '  const [error, setError] = useState(null)',
  '  async function onSubmit(event) {',
  '    const response = await fetch("/api/profile", { method: "POST" })',
  '    if (!response.ok) setError("Could not save")',
  '  }',
  '  return <form onSubmit={onSubmit}><input name="name" required /><button>Save</button>{error}</form>',
  '}',
].join('\n')

const files = {
  'package.json': NEXT_MANIFEST,
  'src/app/page.tsx': 'export default function Home() { return <a href="/profile">Build profile</a> }',
  'src/app/profile/page.tsx': PAGE,
  'src/app/(marketing)/terms/page.tsx': 'export default function Terms() { return <p>Terms</p> }',
  'src/app/api/profile/route.ts': 'export async function POST(request) { return Response.json({ ok: true }) }',
  'src/app/layout.tsx': 'export default function Layout({ children }) { return <nav>{children}</nav> }',
  'src/components/ProfileForm.tsx': FORM,
  'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
}

describe('UI surface detection', () => {
  it('finds file-based routes, layouts and endpoints for a Next.js app', async () => {
    const snapshot = await snapshotOf(files)
    const surface = detectUiSurface(snapshot.entries, NEXT_MANIFEST)!
    expect(surface.frameworks).toEqual(['Next.js (app router)'])
    expect(surface.pages.map((page) => page.route).sort()).toEqual(['/', '/profile', '/terms'])
    expect(surface.layouts).toEqual(['src/app/layout.tsx'])
    expect(matchEndpoint('/api/profile', surface.endpoints)).toBe('src/app/api/profile/route.ts')
    expect(matchEndpoint('/api/users/${id}', [{ path: 'u.ts', route: '/api/users/:id' }])).toBe('u.ts')
    const users = [
      { path: 'app/api/users/[userId]/route.ts', route: '/api/users/:userId' },
      { path: 'app/api/users/stripe/route.ts', route: '/api/users/stripe' },
    ]
    expect(matchEndpoint('/api/users/stripe', users)).toBe('app/api/users/stripe/route.ts')
    expect(matchEndpoint('/api/users/42', users)).toBe('app/api/users/[userId]/route.ts')
  })

  it('returns null for libraries and CLIs with no user-facing surface', async () => {
    const library = await snapshotOf({
      'package.json': '{"name":"left-pad"}',
      'src/index.ts': 'export const pad = () => 1',
      'bin/cli.js': 'console.log(1)',
    })
    expect(detectUiSurface(library.entries, '{"name":"left-pad"}')).toBeNull()
  })

  it('does not treat a pages folder as UI without a UI framework dependency', async () => {
    const docs = await snapshotOf({ 'pages/intro.ts': 'x' })
    expect(detectUiSurface(docs.entries, '{}')).toBeNull()
  })
})

describe('user flow retrieval', () => {
  it('reads pages, first-level components and the endpoint they call', async () => {
    const { snapshot, store } = await storeOf(files)
    const { loadTsPathConfigs } = await import('@/server/repository/tsconfig-paths')
    const { createReferenceResolver } = await import('@/server/repository/references')
    store.useResolver(createReferenceResolver(snapshot.entries, await loadTsPathConfigs(snapshot, store.read, store.getText)))
    const surface = detectUiSurface(snapshot.entries, NEXT_MANIFEST)!
    const context = await buildUserFlowContext(snapshot, store, surface)
    const roles = Object.fromEntries(context.files.map((file) => [file.path, file.role]))
    expect(roles['src/app/profile/page.tsx']).toBe('page')
    expect(roles['src/components/ProfileForm.tsx']).toBe('child')
    expect(roles['src/app/api/profile/route.ts']).toBe('handler')
    expect(context.prompt).toContain('/profile -> src/app/profile/page.tsx')
    expect(context.prompt).toContain('9 |   return <form onSubmit={onSubmit}>')
  })
})

const formLines = FORM.split('\n')
const scope: EvidenceScope = {
  commitSha: 'c'.repeat(40),
  files: new Map([
    ['src/components/ProfileForm.tsx', { path: 'src/components/ProfileForm.tsx', lineCount: 10, ranges: [{ start: 1, end: 10 }], lines: formLines, kind: 'source' as const }],
  ]),
  repositoryPaths: new Set(['src/components/ProfileForm.tsx']),
}
const surface = { frameworks: ['Next.js (app router)'], routes: ['/', '/profile'] }
const ev = (startLine: number, endLine: number) => ({ path: 'src/components/ProfileForm.tsx', startLine, endLine, symbol: null })
const step = (id: string, label: string, kind: UserFlowWire['flows'][number]['steps'][number]['kind'], evidence = [ev(9, 9)]) => ({
  id,
  label,
  kind,
  explanation: null,
  evidence,
})

describe('user flow validation', () => {
  it('accepts a grounded flow and keeps multiple evidence ranges per step', () => {
    const result = finaliseUserFlows(
      {
        flows: [
          {
            id: 'build-profile',
            title: 'Build a profile',
            actor: 'Visitor',
            entryRoute: '/profile',
            summary: null,
            steps: [
              step('enter', 'Enter profile details', 'input'),
              step('submit', 'Submit profile', 'action', [ev(5, 6), ev(9, 9)]),
              step('error', 'See save errors', 'feedback', [ev(7, 7)]),
            ],
          },
        ],
        noFlowsReason: null,
      },
      { scope, surface },
    )
    if (result.status !== 'valid') throw new Error('expected valid')
    expect(result.value.status).toBe('flows')
    expect(result.value.flows[0]!.steps[1]!.evidence).toHaveLength(2)
    expect(result.value.warnings).toEqual([])
  })

  it('returns no flows instead of a manufactured journey when none is supported', () => {
    const result = finaliseUserFlows({ flows: [], noFlowsReason: 'This is a library.' }, { scope, surface })
    expect(result).toMatchObject({ status: 'valid', value: { status: 'no-supported-flows', reason: 'This is a library.', flows: [] } })
  })

  it('drops flows without any valid evidence and clears unknown routes', () => {
    const result = finaliseUserFlows(
      {
        flows: [
          {
            id: 'invented',
            title: 'Sign up',
            actor: 'Visitor',
            entryRoute: '/signup',
            summary: null,
            steps: [step('a', 'Open sign up', 'navigate', [ev(50, 60)]), step('b', 'Create account', 'action', [])],
          },
          {
            id: 'real',
            title: 'Build a profile',
            actor: 'Visitor',
            entryRoute: '/nowhere',
            summary: null,
            steps: [step('a', 'Enter details', 'input'), step('b', 'Save', 'action')],
          },
        ],
        noFlowsReason: null,
      },
      { scope, surface },
    )
    if (result.status !== 'valid') throw new Error('expected valid')
    expect(result.value.flows.map((flow) => flow.id)).toEqual(['real'])
    expect(result.value.flows[0]!.entryRoute).toBeNull()
  })

  it('flags execution-flow style labels', () => {
    for (const label of ['onChange', 'debounce()', 'POST /api/validate', 'verifySession', 'model.run()'])
      expect(looksLikeCode(label), label).toBe(true)
    for (const label of ['Enter profile details', 'Receive validation', 'See result'])
      expect(looksLikeCode(label), label).toBe(false)
  })

  it('requests a model repair when a flow exceeds the step limit', () => {
    const steps = Array.from({ length: 20 }, (_, index) => step(`s${index}`, `Step ${index}`, 'view'))
    const result = finaliseUserFlows(
      { flows: [{ id: 'long', title: 'Long', actor: 'User', entryRoute: null, summary: null, steps }], noFlowsReason: null },
      { scope, surface },
    )
    expect(result.status).toBe('needs-model-repair')
  })
})
