import { describe, expect, it } from 'vitest'
import { ARCHITECTURE_SYSTEM_PROMPT, architectureUserPrompt } from './prompt'
import { architectureWireSchema } from './schema'

describe('architecture prompt', () => {
  it('asks for the product and its capabilities before components, and evidence last', () => {
    const product = ARCHITECTURE_SYSTEM_PROMPT.indexOf('Product first')
    const choose = ARCHITECTURE_SYSTEM_PROMPT.indexOf('Choose the architecture')
    const evidence = ARCHITECTURE_SYSTEM_PROMPT.indexOf('Attach evidence last')
    expect(product).toBeGreaterThan(-1)
    expect(product).toBeLessThan(choose)
    expect(choose).toBeLessThan(evidence)
    expect(Object.keys(architectureWireSchema.shape).slice(0, 3)).toEqual(['summary', 'capabilities', 'groups'])
    expect(architectureUserPrompt('ctx')).toContain('capabilities first')
  })

  it('lets core modules and sampled helpers live inside subsystem nodes', () => {
    expect(ARCHITECTURE_SYSTEM_PROMPT).toContain('usually inside the subsystem node whose primaryPath contains it')
    expect(ARCHITECTURE_SYSTEM_PROMPT).toContain('Never turn the list into one node per file')
    expect(ARCHITECTURE_SYSTEM_PROMPT).toContain('must not become standalone nodes because they appear in the excerpts')
    expect(ARCHITECTURE_SYSTEM_PROMPT).toContain('an existing directory when the component is a subsystem')
    expect(ARCHITECTURE_SYSTEM_PROMPT).not.toContain('Point a node at the file that implements it')
  })
})
