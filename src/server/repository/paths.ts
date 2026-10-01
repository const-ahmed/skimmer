const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  'venv',
  '.venv',
  'env',
  '__pycache__',
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.tmp',
  '.idea',
  '.vscode',
  '.gradle',
  '.terraform',
  'Pods',
  'site-packages',
])

// Matched against the end of the path only: substring matching would drop
// "ui.icons.ts" for ".ico" or "data.source.ts" for ".so".
const IGNORED_SUFFIXES = [
  '.pyc', '.pyo', '.pyd', '.so', '.dll', '.dylib', '.exe', '.class', '.jar',
  '.war', '.o', '.a', '.lib', '.obj', '.wasm', '.bin', '.dat',
  '.jpg', '.jpeg', '.png', '.gif', '.ico', '.svg', '.webp', '.avif', '.bmp',
  '.tif', '.tiff', '.psd', '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi', '.flac',
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.sqlite', '.db', '.log', '.map',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'poetry.lock', 'cargo.lock', 'gemfile.lock', 'composer.lock', 'go.sum',
  'uv.lock', 'pipfile.lock',
]

const SENSITIVE =
  /(?:^|\/)(?:[^/]*(?:secrets?|credentials?|passwords?|private[_-]?key)[^/]*|\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.netrc|\.htpasswd|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|[^/]*service[_-]?account[^/]*\.json|[^/]*\.(?:pem|key|p12|pfx|jks|keystore|crt|cer|der|kdbx|gpg|asc))$/i

const GENERATED =
  /(?:^|\/)(?:dist|build|out|generated|\.next|\.nuxt|\.svelte-kit|\.output|\.vercel|\.turbo|coverage|target|obj)(?:\/|$)|(?:\.generated|\.min|\.bundle)\.[^/]+$|(?:_pb2(?:_grpc)?\.py|\.pb(?:\.gw)?\.go|\.g\.cs|\.d\.[cm]?ts)$/i

// Not part of the product runtime: tests, examples, docs, fixtures, migrations.
const PERIPHERAL =
  /(^|\/)(?:\.[^/]+|tests?|__tests__|__mocks__|mocks?|testdata|fixtures?|e2e|cypress|playwright|examples?(?:_src)?|samples?|demos?|stories|storybook|docs?(?:_src)?|tutorials?(?:_src)?|documentation|bench|benchmarks?|third_party|migrations?|alembic|assets|locales?|translations?)(\/|$)|(?:\.test(?:-d)?|\.spec|\.stories|\.designer)\.|(?:^|\/)(?:test\.[^/]+|bench(?:mark|marker)?\.[^/]+|test_[^/]+|[^/]+_test\.[^/]+)$/i

const SOURCE =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|swift|cs|cpp|cc|c|h|hpp|rb|php|ex|exs|scala|clj|vue|svelte|astro|proto|graphql)$/i

const MANIFEST =
  /(?:^|\/)(?:package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|build\.gradle(?:\.kts)?|pom\.xml|mix\.exs|composer\.json|Gemfile|CMakeLists\.txt)$/i

const README = /^readme(?:\.(?:md|markdown|rst|txt|adoc))?$/i

export function isIgnoredPath(path: string): boolean {
  const lower = path.toLowerCase()
  if (lower.includes('.min.')) return true
  if (IGNORED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true
  return path.split('/').some((segment) => IGNORED_DIRECTORIES.has(segment))
}

export function isSensitivePath(path: string): boolean {
  return SENSITIVE.test(path)
}

export function isGeneratedPath(path: string): boolean {
  return GENERATED.test(path)
}

export function isPeripheralPath(path: string): boolean {
  return PERIPHERAL.test(path)
}

export function isSourcePath(path: string): boolean {
  return SOURCE.test(path)
}

export function isManifestPath(path: string): boolean {
  return MANIFEST.test(path)
}

export function isRootReadme(path: string): boolean {
  return !path.includes('/') && README.test(path)
}

// Manifests count too.
export function isArchitectureSource(path: string): boolean {
  return (
    !PERIPHERAL.test(path) &&
    !GENERATED.test(path) &&
    !SENSITIVE.test(path) &&
    (SOURCE.test(path) || MANIFEST.test(path))
  )
}

export function isReadablePath(path: string): boolean {
  return !isIgnoredPath(path) && !isSensitivePath(path)
}

export function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase()
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

// null when the result would leave the repository.
export function joinPath(base: string, relative: string): string | null {
  const parts = base ? base.split('/') : []
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

export function pathCovers(scope: string, path: string): boolean {
  return path === scope || path.startsWith(`${scope}/`)
}
