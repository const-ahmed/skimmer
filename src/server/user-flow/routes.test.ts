import { describe, expect, it } from 'vitest'
import { storeOf } from '@/test/fixtures'
import { discoverCodeRoutes, routeDeclarations } from './routes'
import { isEntryPage, mergeCodeRoutes, pickPages, rankPages, scanUiSurface, sectionOf, type PageEntry } from './surface'

const REACT = '{"dependencies":{"react":"19","react-router-dom":"7"}}'

describe('code-defined routes', () => {
  it('maps JSX <Route> declarations to page files through imports, skipping wrappers', async () => {
    const files = {
      'package.json': REACT,
      'src/app/AppRouter.tsx': [
        "import { Route, createBrowserRouter, createRoutesFromElements } from 'react-router-dom'",
        "import { Layout } from '../layout/Layout'",
        "import { LazyRoute } from '../layout/LazyRoute'",
        "import { Dashboard } from '../pages/Dashboard'",
        "const SignIn = lazy(() => import('../pages/auth/SignIn'))",
        'export const router = createBrowserRouter(createRoutesFromElements(',
        '  <Route element={<Layout />}>',
        '    <Route path="/" element={<Dashboard />} />',
        '    <Route path="/sign-in" element={<LazyRoute><SignIn /></LazyRoute>} />',
        '    <Route path={dynamicPath()} element={<Dashboard />} />',
        '  </Route>',
        '))',
      ].join('\n'),
      'src/layout/Layout.tsx': 'export const Layout = () => null',
      'src/layout/LazyRoute.tsx': 'export const LazyRoute = () => null',
      'src/pages/Dashboard.tsx': 'export const Dashboard = () => null',
      'src/pages/auth/SignIn.tsx': 'export default () => null',
    }
    const { snapshot, store } = await storeOf(files)
    const found = await discoverCodeRoutes(snapshot, store, REACT)
    expect(found.framework).toBe('React Router (code routes)')
    expect(found.routes.map(({ route, pagePath }) => [route, pagePath])).toEqual([
      ['/', 'src/pages/Dashboard.tsx'],
      ['/sign-in', 'src/pages/auth/SignIn.tsx'],
    ])
  })

  it('resolves route objects whose paths are constants defined elsewhere', async () => {
    const files = {
      'package.json': REACT,
      'src/routing/createRouteObjects.tsx': [
        "import { AppPath } from '../types/AppPath'",
        "const RecordIndexPage = lazy(() => import('../pages/records/RecordIndexPage'))",
        "const ChatPage = lazy(() => import('../pages/chat/ChatPage'))",
        'export const routes = [',
        '  { path: AppPath.RecordIndex, element: (<Suspense><RecordIndexPage /></Suspense>) },',
        '  { path: AppPath.Unknown, element: <ChatPage /> },',
        ']',
      ].join('\n'),
      'src/types/AppPath.ts': "export enum AppPath {\n  RecordIndex = '/objects/:objectNamePlural',\n}",
      'src/pages/records/RecordIndexPage.tsx': 'export default () => null',
      'src/pages/chat/ChatPage.tsx': 'export default () => null',
    }
    const { snapshot, store } = await storeOf(files)
    const found = await discoverCodeRoutes(snapshot, store, REACT)
    expect(found.routes.map(({ route, pagePath }) => [route, pagePath])).toEqual([
      ['/objects/:objectNamePlural', 'src/pages/records/RecordIndexPage.tsx'],
      [null, 'src/pages/chat/ChatPage.tsx'],
    ])
  })

  it('recognises Vue and Angular route arrays with lazy components', () => {
    const vue = routeDeclarations("const routes = [{ path: '/about', component: () => import('./views/About.vue') }]")
    expect(vue).toEqual([{ path: '/about', component: [], specifier: './views/About.vue' }])
    const angular = routeDeclarations(
      "export const routes: Routes = [{ path: 'orders', loadComponent: () => import('./orders/orders.component') }]",
    )
    expect(angular[0]).toMatchObject({ path: 'orders', specifier: './orders/orders.component' })
  })

  it('does nothing without a router dependency, so libraries keep no surface', async () => {
    const files = { 'package.json': '{"name":"lib"}', 'src/routes.ts': "export const routes = [{ path: '/x', component: X }]" }
    const { snapshot, store } = await storeOf(files)
    expect(await discoverCodeRoutes(snapshot, store, files['package.json'])).toEqual({ framework: null, routes: [] })
    expect(mergeCodeRoutes(scanUiSurface(snapshot.entries, files['package.json']), { framework: null, routes: [] })).toBeNull()
  })
})

describe('page selection', () => {
  const page = (path: string, route: string | null = null, routed = false): PageEntry => ({
    path,
    route,
    framework: 'test',
    ...(routed ? { routed } : {}),
  })

  it('recognises sign-in and onboarding pages from routes and file names', () => {
    expect(isEntryPage(page('src/pages/auth/SignInUp.tsx'))).toBe(true)
    expect(isEntryPage(page('src/pages/onboarding/CreateProfile.tsx'))).toBe(true)
    expect(isEntryPage(page('src/pages/x.tsx', '/invite/:token'))).toBe(true)
    expect(isEntryPage(page('src/pages/design/Designer.tsx'))).toBe(false)
    expect(isEntryPage(page('src/pages/records/RecordIndexPage.tsx', '/objects/:name'))).toBe(false)
  })

  it('stops sign-in and onboarding pages from taking every slot', () => {
    const onboarding = Array.from({ length: 10 }, (_, index) => page(`src/pages/onboarding/Step${index}.tsx`))
    const product = [page('src/pages/records/Records.tsx'), page('src/pages/reports/Reports.tsx')]
    // Onboarding pages score higher, as dense forms do.
    const picked = pickPages([...onboarding, ...product], (candidate) => (isEntryPage(candidate) ? 50 : 10), 5)
    expect(picked.filter(isEntryPage).length).toBe(3)
    expect(picked).toEqual(expect.arrayContaining(product))
    // Entry pages still fill slots nothing else can use.
    expect(pickPages([...onboarding, ...product], () => 1, 8).length).toBe(8)
  })

  it('groups pages by the product area their file lives in', () => {
    expect(sectionOf(page('src/pages/settings/profile/Profile.tsx', '/profile'))).toBe('src/pages/settings')
    expect(sectionOf(page('src/modules/settings/accounts/components/New.tsx', '/accounts/new'))).toBe('src/modules/settings')
    expect(sectionOf(page('app/(auth)/login/page.tsx', '/login'))).toBe('app/login')
    expect(sectionOf(page('src/pages/Home.tsx', '/'))).toBe('src/pages/')
  })

  it('spreads pages across product areas instead of one large section', () => {
    const settings = Array.from({ length: 20 }, (_, index) => page(`src/pages/settings/Setting${index}.tsx`, `/settings/s${index}`))
    const others = [page('src/pages/records/Records.tsx', '/records'), page('src/pages/chat/Chat.tsx', '/chat')]
    const picked = rankPages([...settings, ...others]).slice(0, 5)
    expect(picked).toEqual(expect.arrayContaining(others))
    expect(picked.filter((candidate) => candidate.route?.startsWith('/settings')).length).toBeLessThan(5)
  })

  it('prefers pages rendered by code routes and is deterministic', () => {
    const plain = page('src/pages/a/Alpha.tsx')
    const routed = page('src/pages/b/Beta.tsx', null, true)
    expect(rankPages([plain, routed])[0]).toBe(routed)
    expect(rankPages([routed, plain])).toEqual(rankPages([plain, routed]))
  })
})

describe('route targets', () => {
  it('ignores placeholder props and wrapper components when choosing the page', () => {
    const [entry] = routeDeclarations(
      '<Route path="/profile" element={<LazyRoute fallback={<ProfileLoader />}><ProfileEditor /></LazyRoute>} />',
    )
    expect(entry!.component).toEqual(['LazyRoute', 'ProfileEditor'])
  })
})
