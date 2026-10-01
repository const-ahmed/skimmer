import { describe, expect, it } from 'vitest'
import type { ArchitectureResult } from '@/server/architecture/schema'
import { readingOrder } from './reading-order'

type Graph = ArchitectureResult['graph']
const node = (id: string, groupId: string | null = null) => ({ id, label: id, groupId }) as Graph['nodes'][number]
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to }) as Graph['edges'][number]
const group = (id: string) => ({ id, label: id }) as Graph['groups'][number]
const ids = (graph: Graph) => readingOrder(graph).map((section) => [section.group?.id ?? null, section.nodes.map((n) => n.id)])

describe('readingOrder', () => {
  it('follows edges, not model order', () => {
    const graph = { groups: [], nodes: [node('db'), node('api'), node('user')], edges: [edge('user', 'api'), edge('api', 'db')] }
    expect(ids(graph)).toEqual([[null, ['user', 'api', 'db']]])
  })

  it('keeps groups together and orders them by their first component', () => {
    const graph = {
      groups: [group('data'), group('web')],
      nodes: [node('db', 'data'), node('cache', 'data'), node('page', 'web'), node('user')],
      edges: [edge('user', 'page'), edge('page', 'db'), edge('page', 'cache')],
    }
    expect(ids(graph)).toEqual([
      [null, ['user']],
      ['web', ['page']],
      ['data', ['db', 'cache']],
    ])
  })

  it('survives cycles and puts unconnected components last', () => {
    const graph = { groups: [], nodes: [node('lib'), node('a'), node('b')], edges: [edge('a', 'b'), edge('b', 'a')] }
    expect(ids(graph)).toEqual([[null, ['a', 'b', 'lib']]])
  })
})
