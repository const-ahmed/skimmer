import { createAreaIndex } from './areas'
import { dirname, isArchitectureSource, isGeneratedPath, isPeripheralPath } from './paths'
import { scoreArchitecturePath } from './ranking'
import type { TreeEntry } from './types'

interface Area {
  key: string
  weight: number
  fileCount: number
  queue: string[]
  next: number
  used: number
}

export interface TreeSelection {
  paths: string[]
  directories: Set<string>
  areaFileCounts: Map<string, number>
  totalPaths: number
}

const lineCost = (path: string, directory: boolean, count?: number) =>
  path.length + (directory ? 1 : 0) + (count === undefined ? 0 : String(count).length + 9) + 1

// Areas share the budget by sqrt(runtime source files), so a huge package gets more room without crowding out the rest. Within an area, structure comes before leaves.
export function selectTreePaths(
  entries: ReadonlyMap<string, TreeEntry>,
  ranked: readonly string[],
  budget: number,
): TreeSelection {
  const all = [...entries.values()]
  const directories = new Set(all.filter((entry) => entry.type === 'tree').map((entry) => entry.path))
  const everything = all.map((entry) => entry.path)
  const fullCost = everything.reduce((sum, path) => sum + lineCost(path, directories.has(path)), 0)
  if (fullCost <= budget)
    return { paths: everything.sort(), directories, areaFileCounts: new Map(), totalPaths: everything.length }

  const { areaOf, weightOf } = createAreaIndex(entries)

  const sourceCounts = new Map<string, number>()
  const fileCounts = new Map<string, number>()
  for (const entry of all) {
    if (entry.type !== 'blob') continue
    const area = areaOf(entry.path)
    fileCounts.set(area, (fileCounts.get(area) ?? 0) + 1)
    if (!isArchitectureSource(entry.path)) continue
    for (let folder = dirname(entry.path); folder; folder = dirname(folder))
      sourceCounts.set(folder, (sourceCounts.get(folder) ?? 0) + 1)
  }

  const rankedSet = new Set(ranked)
  const members = new Map<string, string[]>()
  for (const path of everything) {
    const area = areaOf(path)
    if (path === area) continue
    const list = members.get(area)
    if (list) list.push(path)
    else members.set(area, [path])
  }

  const areas: Area[] = [...new Set([...members.keys(), ...everything.map(areaOf)])].map((key) => {
    const paths = members.get(key) ?? []
    const base = key ? key.split('/').length : 0
    const relativeDepth = (path: string) => path.split('/').length - base
    const structural = (path: string) =>
      directories.has(path) && !isPeripheralPath(path) && !isGeneratedPath(path) && (sourceCounts.get(path) ?? 0) > 0
    const bySize = (a: string, b: string) =>
      relativeDepth(a) - relativeDepth(b) ||
      (sourceCounts.get(b) ?? 0) - (sourceCounts.get(a) ?? 0) ||
      (a < b ? -1 : a > b ? 1 : 0)
    const dirs = paths.filter(structural).sort(bySize)
    const shallow = dirs.filter((path) => relativeDepth(path) <= 2)
    const deep = dirs.filter((path) => relativeDepth(path) > 2)
    const rankedHere = ranked.filter((path) => areaOf(path) === key && entries.has(path))
    const sources = paths
      .filter((path) => !directories.has(path) && !rankedSet.has(path) && isArchitectureSource(path))
      .sort((a, b) => scoreArchitecturePath(b) - scoreArchitecturePath(a) || (a < b ? -1 : a > b ? 1 : 0))
    const queue = [...new Set([...shallow, ...rankedHere, ...deep, ...sources])]
    return {
      key,
      weight: weightOf(key),
      fileCount: fileCounts.get(key) ?? 0,
      queue,
      next: 0,
      used: 0,
    }
  })
  areas.sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const chosen: string[] = []
  const areaFileCounts = new Map<string, number>()
  let remaining = budget
  const take = (path: string, cost: number) => {
    chosen.push(path)
    remaining -= cost
  }
  for (const area of areas) {
    if (!area.key || !directories.has(area.key)) continue
    const cost = lineCost(area.key, true, area.fileCount)
    if (cost > remaining) continue
    take(area.key, cost)
    areaFileCounts.set(area.key, area.fileCount)
    area.used += cost
  }

  // Weighted fair sharing: the area furthest below its share goes next.
  const fill = (pool: Area[], weightOf: (area: Area) => number) => {
    while (true) {
      let pick: Area | null = null
      for (const area of pool) {
        while (area.next < area.queue.length) {
          const path = area.queue[area.next]!
          if (lineCost(path, directories.has(path)) <= remaining) break
          area.next++
        }
        if (area.next >= area.queue.length) continue
        if (!pick || area.used / weightOf(area) < pick.used / weightOf(pick)) pick = area
      }
      if (!pick) return
      const path = pick.queue[pick.next++]!
      const cost = lineCost(path, directories.has(path))
      take(path, cost)
      pick.used += cost
    }
  }
  fill(areas.filter((area) => area.weight > 0), (area) => area.weight)
  fill(areas.filter((area) => area.weight === 0), () => 1)

  return { paths: chosen.sort(), directories, areaFileCounts, totalPaths: everything.length }
}

export function renderTreePaths(selection: TreeSelection): string {
  return selection.paths
    .map((path) => {
      const shown = selection.directories.has(path) ? `${path}/` : path
      const count = selection.areaFileCounts.get(path)
      return count === undefined ? shown : `${shown} (${count} files)`
    })
    .join('\n')
}
