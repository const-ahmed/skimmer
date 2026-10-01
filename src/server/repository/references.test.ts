import { describe, expect, it } from 'vitest'
import { REPOSITORY_LIMITS } from '@/server/analysis/limits'
import { createReferenceResolver } from './references'
import type { TsPathConfig } from './tsconfig-paths'
import type { TreeEntry } from './types'

function resolverFor(files: string[], folders: string[] = [], configs: TsPathConfig[] = []) {
  const entries = new Map<string, TreeEntry>()
  const sha = 'a'.repeat(40)
  for (const folder of folders) entries.set(folder, { path: folder, type: 'tree', sha })
  for (const file of files) {
    const parts = file.split('/')
    for (let index = 1; index < parts.length; index++) {
      const folder = parts.slice(0, index).join('/')
      entries.set(folder, { path: folder, type: 'tree', sha })
    }
    entries.set(file, { path: file, type: 'blob', sha, size: 10 })
  }
  const resolve = createReferenceResolver(entries, configs)
  return {
    paths: (path: string, text: string) => resolve(path, text).map((reference) => reference.toPath),
    full: resolve,
  }
}

describe('static references', () => {
  it('resolves JavaScript relative, extensionless, index and ESM .js imports with their lines', () => {
    const { full } = resolverFor([
      'src/app/page.tsx',
      'src/components/Editor.tsx',
      'src/components/index.ts',
      'src/lib/store.ts',
      'src/server/db.ts',
    ])
    const text = [
      'import { Editor } from "../components/Editor";',
      'import * as all from "../components";',
      '',
      'export { db } from "../server/db.js";',
      'import React from "react";',
      'const lazy = () => import("../lib/store");',
    ].join('\n')
    expect(full('src/app/page.tsx', text)).toEqual([
      { fromPath: 'src/app/page.tsx', toPath: 'src/components/Editor.tsx', line: 1 },
      { fromPath: 'src/app/page.tsx', toPath: 'src/components/index.ts', line: 2 },
      { fromPath: 'src/app/page.tsx', toPath: 'src/server/db.ts', line: 4 },
      { fromPath: 'src/app/page.tsx', toPath: 'src/lib/store.ts', line: 6 },
    ])
  })

  it('uses real tsconfig path mappings instead of assuming aliases', () => {
    const config: TsPathConfig = {
      directory: '',
      baseUrl: null,
      mappings: [
        { pattern: '@/*', targets: ['app/*'] },
        { pattern: '@ui/*', targets: ['packages/ui/src/*'] },
      ],
    }
    const { paths } = resolverFor(
      ['app/lib/store.ts', 'src/lib/store.ts', 'packages/ui/src/button.tsx', 'app/page.tsx'],
      [],
      [config],
    )
    expect(
      paths('app/page.tsx', 'import { store } from "@/lib/store";\nimport { Button } from "@ui/button";'),
    ).toEqual(['app/lib/store.ts', 'packages/ui/src/button.tsx'])
  })

  it('falls back to the src/ alias convention only when no tsconfig applies', () => {
    const { paths } = resolverFor(['src/lib/store.ts', 'src/app.ts'])
    expect(paths('src/app.ts', 'import { store } from "~/lib/store";')).toEqual(['src/lib/store.ts'])
  })

  it('maps scoped workspace packages to their folder but never unscoped names', () => {
    const { paths } = resolverFor(
      ['packages/next/src/server.ts', 'packages/server/src/index.ts'],
      ['packages/next', 'packages/server'],
    )
    expect(
      paths('packages/next/src/server.ts', 'import { initTRPC } from "@trpc/server";\nimport { headers } from "next/headers";'),
    ).toEqual(['packages/server'])
  })

  it('resolves Python relative, absolute and submodule imports', () => {
    const { full } = resolverFor([
      'httpx/__init__.py',
      'httpx/_client.py',
      'httpx/_models.py',
      'httpx/_transports/__init__.py',
      'httpx/_transports/default.py',
      'src/pkg/service.py',
    ])
    const references = full(
      'httpx/_client.py',
      ['from ._models import Request, Response', 'from ._transports import default', 'import pkg.service', 'import json'].join('\n'),
    )
    expect(references.map((reference) => [reference.toPath, reference.line])).toEqual([
      ['httpx/_models.py', 1],
      ['httpx/_transports/default.py', 2],
      ['src/pkg/service.py', 3],
    ])
  })

  it('resolves Rust crate paths and mod declarations', () => {
    const { paths } = resolverFor(['src/main.rs', 'src/network/mod.rs', 'src/network/proxy.rs', 'src/network/cors.rs', 'src/token/auth.rs'])
    expect(paths('src/network/proxy.rs', 'use crate::token::auth::validate;\nuse super::cors::apply;').sort()).toEqual([
      'src/network/cors.rs',
      'src/token/auth.rs',
    ])
    expect(paths('src/network/mod.rs', 'pub mod proxy;\nmod cors;\n')).toEqual(['src/network/proxy.rs', 'src/network/cors.rs'])
  })

  it('resolves Go module imports to package folders, never the standard library, with block lines', () => {
    const { full } = resolverFor(['cmd/api/main.go', 'internal/store/store.go'], ['internal/store'])
    expect(
      full('cmd/api/main.go', 'package main\n\nimport (\n  "net/http"\n  "github.com/acme/app/internal/store"\n)\n'),
    ).toEqual([{ fromPath: 'cmd/api/main.go', toPath: 'internal/store', line: 5 }])
  })

  it('names class-per-file types only when unique, ignoring comments but keeping line numbers', () => {
    const { full } = resolverFor(['SipBridge.cs', 'SipVoiceAgent.cs', 'OfficeBridge.cs', 'Tui.cs'])
    const references = full(
      'SipBridge.cs',
      ['// OfficeBridge is not used here', '/* multi', ' line */', 'var agent = new SipVoiceAgent(config);', 'Tui.Refresh();'].join('\n'),
    )
    expect(references.map((reference) => [reference.toPath, reference.line])).toEqual([
      ['SipVoiceAgent.cs', 4],
      ['Tui.cs', 5],
    ])
  })

  it('resolves Java imports and C includes', () => {
    const java = resolverFor(['src/main/java/com/acme/Api.java', 'src/main/java/com/acme/store/Repo.java'])
    expect(java.paths('src/main/java/com/acme/Api.java', 'import com.acme.store.Repo;')).toEqual([
      'src/main/java/com/acme/store/Repo.java',
    ])
    const c = resolverFor(['src/net/socket.c', 'src/net/socket.h', 'include/util.h'])
    expect(c.paths('src/net/socket.c', '#include "socket.h"\n#include "util.h"\n#include <stdio.h>')).toEqual([
      'src/net/socket.h',
      'include/util.h',
    ])
  })

  it('never lists the file itself, paths outside the repository, or too many files', () => {
    const files = Array.from({ length: 60 }, (_, index) => `src/m${index}.ts`)
    const { paths } = resolverFor(['src/main.ts', ...files])
    const text = ['import "./main";', 'import "../../outside";', ...files.map((file) => `import "./${file.slice(4, -3)}";`)].join('\n')
    const references = paths('src/main.ts', text)
    expect(references).not.toContain('src/main.ts')
    expect(references).toHaveLength(REPOSITORY_LIMITS.maxReferencesPerFile)
  })
})
