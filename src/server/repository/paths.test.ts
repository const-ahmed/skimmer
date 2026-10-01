import { describe, expect, it } from 'vitest'
import {
  isArchitectureSource,
  isGeneratedPath,
  isIgnoredPath,
  isReadablePath,
  isSensitivePath,
} from './paths'

describe('source filtering', () => {
  it('drops dependency folders and binary assets but keeps look-alike source names', () => {
    expect(isIgnoredPath('node_modules/react/index.js')).toBe(true)
    expect(isIgnoredPath('vendor/lib/a.go')).toBe(true)
    expect(isIgnoredPath('public/logo.png')).toBe(true)
    expect(isIgnoredPath('dist/app.min.js')).toBe(true)
    expect(isIgnoredPath('package-lock.json')).toBe(true)
    // Suffix, not substring, matching.
    expect(isIgnoredPath('src/ui.icons.ts')).toBe(false)
    expect(isIgnoredPath('src/data.source.ts')).toBe(false)
    expect(isIgnoredPath('src/model.classifier.py')).toBe(false)
  })

  it('never reads obvious secret or key files', () => {
    for (const path of [
      '.env',
      '.env.production',
      'config/secrets.yml',
      'deploy/private_key.txt',
      'certs/server.pem',
      'keys/id_rsa',
      '.npmrc',
      'gcp-service-account.json',
      'android/release.keystore',
    ]) {
      expect(isSensitivePath(path), path).toBe(true)
      expect(isReadablePath(path), path).toBe(false)
    }
    expect(isSensitivePath('src/auth/session.ts')).toBe(false)
  })

  it('treats build output and generated code as non-architectural', () => {
    expect(isGeneratedPath('build/index.js')).toBe(true)
    expect(isGeneratedPath('.next/server/app.js')).toBe(true)
    expect(isGeneratedPath('proto/api_pb2.py')).toBe(true)
    expect(isGeneratedPath('src/types.d.ts')).toBe(true)
    expect(isGeneratedPath('bin/cli.js')).toBe(false)
    expect(isArchitectureSource('src/server/index.ts')).toBe(true)
    expect(isArchitectureSource('src/server/index.test.ts')).toBe(false)
    expect(isArchitectureSource('docs/guide.ts')).toBe(false)
    expect(isArchitectureSource('package.json')).toBe(true)
  })
})
