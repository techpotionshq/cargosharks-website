import { describe, expect, it } from 'vitest'
import {
  IllegalTransitionError,
  assertTransition,
  canTransition,
  invoiceMachine,
  isTerminal,
  jobMachine,
  permissionKeys,
  permittedTransitions,
  quoteMachine,
} from '../src/index'

describe('illegal transitions are rejected in core, not hidden in the UI', () => {
  it('refuses to close a job that was never delivered', () => {
    expect(() => assertTransition(jobMachine, 'booked', 'closed')).toThrow(IllegalTransitionError)
  })

  it('allows the operational path', () => {
    expect(canTransition(jobMachine, 'booked', 'in_transit')).toBe(true)
    expect(canTransition(jobMachine, 'delivered', 'completed')).toBe(true)
    expect(canTransition(jobMachine, 'completed', 'closed')).toBe(true)
  })
})

describe('nothing is deleted (§5.5)', () => {
  it('credits an issued invoice rather than voiding it', () => {
    expect(canTransition(invoiceMachine, 'issued', 'void')).toBe(false)
    expect(canTransition(invoiceMachine, 'issued', 'credited')).toBe(true)
  })

  it('supersedes a sent quote rather than editing it', () => {
    expect(canTransition(quoteMachine, 'sent', 'superseded')).toBe(true)
    expect(isTerminal(quoteMachine, 'superseded')).toBe(true)
  })
})

describe('permissions gate the available actions (FR-ID-03)', () => {
  it('filters transitions by the principal permission set', () => {
    const coordinator = new Set(['job.update', 'job.hold'])
    const available = permittedTransitions(jobMachine, 'in_transit', coordinator).map((t) => t.to)
    expect(available).toContain('arrived')
    expect(available).toContain('on_hold')

    const readOnly = new Set<string>()
    expect(permittedTransitions(jobMachine, 'in_transit', readOnly)).toHaveLength(0)
  })

  it('exposes every key the machines reference, for seeding role_permissions', () => {
    const keys = permissionKeys()
    expect(keys).toContain('invoice.credit')
    expect(keys).toContain('customs.file')
    expect(new Set(keys).size).toBe(keys.length)
  })
})
