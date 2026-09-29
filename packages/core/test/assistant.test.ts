import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_LIMITS,
  ASSISTANT_TOOLS,
  assistantTool,
  isProposableEntity,
  proposableTransitions,
  proposeTransition,
  toolsFor,
} from '../src/assistant'
import { allPermissionKeys } from '../src/states'
import { AiError } from '../src/ai'

const everything = new Set(allPermissionKeys())
const readOnly = new Set<string>()

describe('the tool manifest', () => {
  it('names every tool exactly once', () => {
    const names = ASSISTANT_TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  /*
    Every property in `required`, nullable where optional — the rule
    `extraction.ts` learned from a live call. A key outside `required` is one
    the model may decline to emit, and a silently absent filter is a query that
    answered a different question than the one asked.
  */
  it('requires every parameter, making the optional ones nullable', () => {
    for (const tool of ASSISTANT_TOOLS) {
      const schema = tool.parameters as {
        required: string[]
        properties: Record<string, { type: unknown }>
      }
      expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort())
    }
  })

  it('refuses fields it did not ask for', () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect((tool.parameters as { additionalProperties: unknown }).additionalProperties).toBe(
        false,
      )
    }
  })

  /*
    The rule that keeps a prompt from becoming a tenancy boundary: no tool
    takes a branch, so no wording can point one somewhere else. RLS decides,
    from the actor stamped on the transaction.
  */
  it('gives no tool a branch parameter', () => {
    for (const tool of ASSISTANT_TOOLS) {
      const properties = Object.keys((tool.parameters as { properties: object }).properties)
      expect(properties.filter((key) => /branch/i.test(key))).toEqual([])
    }
  })

  it('offers read tools to everyone and proposal tools only to those who may act', () => {
    const offered = toolsFor(readOnly)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.every((tool) => tool.kind === 'read')).toBe(true)
    expect(toolsFor(everything).some((tool) => tool.kind === 'propose')).toBe(true)
  })

  it('finds a tool by name and nothing by a name it does not have', () => {
    expect(assistantTool('get_job')?.kind).toBe('read')
    expect(assistantTool('delete_everything')).toBeUndefined()
  })

  /*
    The finance reads are offered to everyone and gated by nothing but RLS —
    the same contract every read tool holds, asserted by name so adding one
    that quietly carries a `requires` (and so disappears from a coordinator's
    assistant) fails here rather than in the field.
  */
  it('offers the finance read tools to everyone, gated only by RLS', () => {
    const offered = new Set(toolsFor(readOnly).map((tool) => tool.name))
    for (const name of [
      'list_unbilled',
      'list_quotes_expiring',
      'get_margin',
      'get_customer_credit',
      'list_consolidation_candidates',
    ]) {
      expect(offered.has(name)).toBe(true)
      expect(assistantTool(name)?.kind).toBe('read')
      expect(assistantTool(name)?.requires).toBeUndefined()
    }
  })

  it('keeps the loop bounded', () => {
    expect(ASSISTANT_LIMITS.maxTurns).toBeGreaterThan(0)
    expect(ASSISTANT_LIMITS.maxTurns).toBeLessThanOrEqual(10)
    expect(ASSISTANT_LIMITS.maxToolCalls).toBeGreaterThanOrEqual(ASSISTANT_LIMITS.maxTurns)
  })
})

describe('proposeTransition', () => {
  const base = {
    reference: 'KWI-JOB-2026-00042',
    targetId: '01920000-0000-7000-8000-000000000001',
    permissions: everything,
  }

  it('accepts a legal move and takes its label from the product, not the model', () => {
    const proposal = proposeTransition({
      ...base,
      entity: 'job',
      from: 'arrived',
      to: 'customs',
      reason: 'Documents are with the broker.',
    })

    expect(proposal.to).toBe('customs')
    /*
      The record's id travels with the proposal. Without it the confirm button
      has only a reference, and the registers filter by status rather than by
      reference — so the link would land on an unfiltered list with no
      indication of which row was meant.
    */
    expect(proposal.targetId).toBe('01920000-0000-7000-8000-000000000001')
    // The product's own word for this transition, already translated.
    expect(proposal.label).toBe('Entered clearance')
    expect(proposal.reason).toBe('Documents are with the broker.')
  })

  /*
    The refusal that matters most, and the reason it lists the alternatives:
    a model told only "not allowed" guesses again, and the coordinator waits
    two more turns for a button.
  */
  it('refuses an illegal move and names what is legal instead', () => {
    expect(() =>
      proposeTransition({ ...base, entity: 'job', from: 'draft', to: 'delivered' }),
    ).toThrow(/cannot move to delivered/)

    try {
      proposeTransition({ ...base, entity: 'job', from: 'draft', to: 'delivered' })
    } catch (error) {
      expect((error as Error).message).toMatch(/booked/)
    }
  })

  it('says so plainly when a record is final', () => {
    expect(() =>
      proposeTransition({ ...base, entity: 'job', from: 'closed', to: 'booked' }),
    ).toThrow(/is final/)
  })

  /*
    Offering a button that will refuse is how an assistant teaches people to
    distrust it, so the permission is checked before the offer as well as at
    the confirm.
  */
  it('refuses to offer a move this person may not make', () => {
    expect(() =>
      proposeTransition({
        ...base,
        entity: 'job',
        from: 'arrived',
        to: 'customs',
        permissions: readOnly,
      }),
    ).toThrow(/do not have permission/)
  })

  it('refuses an entity that has no state machine', () => {
    expect(() =>
      proposeTransition({ ...base, entity: 'payroll', from: 'draft', to: 'paid' }),
    ).toThrow(AiError)
  })

  it('knows which entities are proposable', () => {
    expect(isProposableEntity('job')).toBe(true)
    expect(isProposableEntity('customs')).toBe(true)
    expect(isProposableEntity('shipment')).toBe(false)
  })
})

describe('proposableTransitions', () => {
  it('lists what a record could become, for the model to choose from', () => {
    const options = proposableTransitions('job', 'arrived', everything).map((t) => t.to)
    expect(options).toContain('customs')
    expect(options).toContain('delivered')
    expect(options).not.toContain('draft')
  })

  it('hides the moves this person may not make', () => {
    expect(proposableTransitions('job', 'arrived', readOnly)).toEqual([])
  })

  /*
    The manifest is `states.ts` itself, not a copy of it. A transition added to
    the product is suggestible on the same commit; one removed stops being
    suggestible without anybody remembering to look at the assistant.
  */
  it('reads the machines rather than a list of its own', () => {
    const invoiceOptions = proposableTransitions('invoice', 'approved', everything).map((t) => t.to)
    expect(invoiceOptions.sort()).toEqual(['draft', 'issued', 'void'])
  })
})
