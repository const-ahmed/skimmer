import {
  dirname,
  isArchitectureSource,
  isGeneratedPath,
  isManifestPath,
  isPeripheralPath,
} from './paths'
import type { TreeEntry } from './types'

export interface AreaIndex {
  /**
   * A top-level slice of the repository: a workspace package in a monorepo
   * ("packages/api"), otherwise a top-level directory ("src"), or "" for files
   * at the root.
   */
  areaOf(path: string): string
  /**
   * sqrt(runtime source files in the area), so a huge area counts for more
   * than a small one without dwarfing it. 0 for peripheral or generated areas
   * (docs, examples, .github, build output) and areas with no runtime source.
   */
  weightOf(area: string): number
}

export function createAreaIndex(entries: ReadonlyMap<string, TreeEntry>): AreaIndex {
  const all = [...entries.values()]
  const directories = new Set(all.filter((entry) => entry.type === 'tree').map((entry) => entry.path))
  // Top-level folders that hold package manifests below them: workspace containers.
  const containers = new Set<string>()
  for (const entry of all) {
    if (entry.type !== 'blob' || !isManifestPath(entry.path)) continue
    const root = dirname(entry.path)
    if (root.includes('/') && !isPeripheralPath(root) && !isGeneratedPath(root)) containers.add(root.split('/')[0]!)
  }
  const areaOf = (path: string): string => {
    const segments = path.split('/')
    if (segments.length === 1) return directories.has(path) && !containers.has(path) ? path : ''
    if (!containers.has(segments[0]!)) return segments[0]!
    // Scoped workspaces ("packages/@acme/ui") keep the scope and the package.
    const depth = segments[1]!.startsWith('@') ? 3 : 2
    return segments.slice(0, Math.min(depth, segments.length)).join('/')
  }
  const runtime = new Map<string, number>()
  for (const entry of all)
    if (entry.type === 'blob' && isArchitectureSource(entry.path)) {
      const area = areaOf(entry.path)
      runtime.set(area, (runtime.get(area) ?? 0) + 1)
    }
  return {
    areaOf,
    weightOf: (area) =>
      area !== '' && (isPeripheralPath(area) || isGeneratedPath(area)) ? 0 : Math.sqrt(runtime.get(area) ?? 0),
  }
}
