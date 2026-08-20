import { describe, expect, it } from 'vitest'
import {
  IllegalTransitionError,
  assertTransition,
  canTransition,
  customsMachine,
  entryPermission,
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

describe('what reaching a state demands (entryPermission)', () => {
  /**
   * The bug this closes: the customs form asserted `customs.update` for every
   * move, so a coordinator correcting a declaration number could also file the
   * declaration and clear the duty — two keys the machine declares and nothing
   * checked.
   */
  it('reads the separation of duties off the customs machine', () => {
    expect(entryPermission(customsMachine, 'declaration_filed')).toBe('customs.file')
    expect(entryPermission(customsMachine, 'duty_paid')).toBe('customs.pay')
    expect(entryPermission(customsMachine, 'released')).toBe('customs.update')
  })

  /** Reached from four states, all demanding the same key — still unambiguous. */
  it('is content when every path into a state agrees', () => {
    expect(entryPermission(customsMachine, 'inspection')).toBe('customs.update')
  })

  /** The initial state is entered by creation, not by a transition. */
  it('demands nothing for a state nothing transitions into', () => {
    expect(entryPermission(customsMachine, 'not_started')).toBeUndefined()
  })

  /**
   * Loudly, rather than by guessing.
   *
   * Returning `undefined` would silently drop the check and returning either
   * key would enforce a permission the principal's actual path did not
   * require. Both are worse than a caller that has to use `assertTransition`.
   */
  it('refuses to answer where two paths in disagree', () => {
    const forked = {
      name: 'forked',
      initial: 'a' as const,
      states: ['a', 'b', 'c'] as const,
      terminal: [] as const,
      transitions: [
        { from: 'a', to: 'c', requires: 'one', label: 'via a' },
        { from: 'b', to: 'c', requires: 'two', label: 'via b' },
      ],
    }

    expect(() => entryPermission(forked, 'c')).toThrow(/different permissions/)
    expect(() => entryPermission(forked, 'c')).toThrow(/one, two/)
  })

  /** A guarded path and an unguarded one into the same state is the same fault. */
  it('refuses where one path in is unguarded', () => {
    const partly = {
      name: 'partly',
      initial: 'a' as const,
      states: ['a', 'b', 'c'] as const,
      terminal: [] as const,
      transitions: [
        { from: 'a', to: 'c', requires: 'one', label: 'guarded' },
        { from: 'b', to: 'c', label: 'unguarded' },
      ],
    }

    expect(() => entryPermission(partly, 'c')).toThrow(/none, one/)
  })
})
