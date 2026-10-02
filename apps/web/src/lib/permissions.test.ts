/**
 * Permission checks — FR-ID-03.
 *
 * These decide what the interface offers, not what the database allows, and
 * the module says so itself. That does not make them untestable or unimportant:
 * a check that is wrong in the *permissive* direction renders a button that
 * fails at the policy, which reads to an operator as a broken product; wrong in
 * the *restrictive* direction, it hides work someone is paid to do and the
 * report is "the system won't let me", which is expensive to diagnose because
 * nothing errors anywhere.
 *
 * The branch checks matter more than the permission ones. `assertInBranch`
 * guards every money mutation in the ledger, and a principal holding a role in
 * one branch must not act in another (FR-ID-02).
 */

import { describe, expect, it } from 'vitest'
import { invoiceMachine } from '@qabandi/core'
import {
  ForbiddenError,
  SETTINGS_AREAS,
  assertCan,
  assertCanIn,
  assertInBranch,
  availableActions,
  branchesWhere,
  can,
  canIn,
  canOpenSettings,
  inBranch,
  permittedBranches,
  settingsAreasFor,
} from './permissions'
import type { Session } from './session'

const KUWAIT = '00000000-0000-7000-8000-0000000000b1'
const DUBAI = '00000000-0000-7000-8000-0000000000b2'

/** Only the two fields these functions read; the rest is never touched. */
function session(permissions: string[], branches: Array<[string, string]> = []): Session {
  return {
    permissions: new Set(permissions),
    branchRoles: new Map(branches),
  } as unknown as Session
}

describe('can / assertCan', () => {
  it('grants a held permission', () => {
    expect(can(session(['invoice.issue']), 'invoice.issue')).toBe(true)
  })

  it('refuses one that is not held', () => {
    expect(can(session(['invoice.issue']), 'invoice.void')).toBe(false)
  })

  it('refuses on an empty permission set', () => {
    expect(can(session([]), 'invoice.issue')).toBe(false)
  })

  /**
   * Permission keys are exact strings, never prefixes. `invoice.issue` must not
   * satisfy a check for `invoice.issue.override` or vice versa — a matrix that
   * matches by prefix grants authority nobody granted.
   */
  it('matches exactly, not by prefix', () => {
    expect(can(session(['invoice']), 'invoice.issue')).toBe(false)
    expect(can(session(['invoice.issue']), 'invoice')).toBe(false)
    expect(can(session(['invoice.issue']), 'invoice.issue.override')).toBe(false)
  })

  it('throws ForbiddenError naming the permission', () => {
    expect(() => assertCan(session([]), 'payment.record')).toThrow(ForbiddenError)
    try {
      assertCan(session([]), 'payment.record')
    } catch (error) {
      expect((error as ForbiddenError).permission).toBe('payment.record')
      expect((error as Error).name).toBe('ForbiddenError')
    }
  })

  it('does not throw when the permission is held', () => {
    expect(() => assertCan(session(['payment.record']), 'payment.record')).not.toThrow()
  })
})

describe('branch scoping — FR-ID-02', () => {
  const kuwaitOnly = session(['payment.record'], [[KUWAIT, 'finance']])

  it('admits a branch the principal holds a role in', () => {
    expect(inBranch(kuwaitOnly, KUWAIT)).toBe(true)
  })

  /**
   * The check that guards every money mutation in the ledger slice. Holding
   * finance in Kuwait must not let you record a receipt in Dubai.
   */
  it('refuses a branch the principal holds no role in', () => {
    expect(inBranch(kuwaitOnly, DUBAI)).toBe(false)
    expect(() => assertInBranch(kuwaitOnly, DUBAI)).toThrow(ForbiddenError)
  })

  it('names the branch in the error, not the permission', () => {
    try {
      assertInBranch(kuwaitOnly, DUBAI)
    } catch (error) {
      expect((error as ForbiddenError).permission).toBe(`branch:${DUBAI}`)
    }
  })

  it('follows the whole branch list, not the first entry', () => {
    const both = session(
      [],
      [
        [KUWAIT, 'finance'],
        [DUBAI, 'coordinator'],
      ],
    )
    expect(inBranch(both, KUWAIT)).toBe(true)
    expect(inBranch(both, DUBAI)).toBe(true)
  })

  it('refuses everything when the principal holds no role anywhere', () => {
    expect(inBranch(session([]), KUWAIT)).toBe(false)
  })

  /** A permission is not a branch. Holding one grants nothing about the other. */
  it('does not let a permission stand in for a branch role', () => {
    const noBranches = session(['payment.record'])
    expect(() => assertInBranch(noBranches, KUWAIT)).toThrow(ForbiddenError)
  })
})

describe('settings areas', () => {
  it('offers nothing to a principal with no administration keys', () => {
    expect(settingsAreasFor(session(['job.read']))).toEqual([])
    expect(canOpenSettings(session(['job.read']))).toBe(false)
  })

  it('offers only the areas the principal holds', () => {
    const auditor = session(['admin.audit.read'])
    expect(settingsAreasFor(auditor).map((a) => a.key)).toEqual(['audit'])
    expect(canOpenSettings(auditor)).toBe(true)
  })

  /**
   * Vendor access rides on `admin.users.write` deliberately — the module
   * explains why. Pinned here so that splitting it into its own key is a
   * decision someone makes rather than a line someone changes.
   */
  it('gates support access on the same key as users', () => {
    const admin = session(['admin.users.write'])
    expect(settingsAreasFor(admin).map((a) => a.key)).toEqual(['users', 'support'])
  })

  /**
   * Order is the navigation order, and `/settings` redirects to the first
   * entry the principal can see. A reordering silently changes where the
   * settings link lands.
   */
  it('returns areas in navigation order', () => {
    const everything = session(SETTINGS_AREAS.map((a) => a.permission))
    expect(settingsAreasFor(everything).map((a) => a.key)).toEqual([
      'users',
      'branches',
      'audit',
      'support',
      'notifications',
      'apiKeys',
      'mailboxes',
      'whatsappNumbers',
      'integrations',
      'brand',
    ])
  })

  it('agrees with canOpenSettings in both directions', () => {
    for (const area of SETTINGS_AREAS) {
      const only = session([area.permission])
      expect(canOpenSettings(only)).toBe(true)
      expect(settingsAreasFor(only).length).toBeGreaterThan(0)
    }
    expect(canOpenSettings(session([]))).toBe(false)
    expect(settingsAreasFor(session([]))).toEqual([])
  })
})

describe('availableActions', () => {
  /**
   * Actions come from the state machine, so a transition that exists in
   * `core/states.ts` appears in the interface without a component being
   * edited — and one the principal lacks the permission for does not.
   */
  it('offers no action without the permission', () => {
    expect(availableActions(session([]), invoiceMachine, 'draft')).toEqual([])
  })

  it('offers only transitions legal from the current state', () => {
    const finance = session(['invoice.issue', 'invoice.void', 'invoice.credit', 'invoice.approve'])
    const fromDraft = availableActions(finance, invoiceMachine, 'draft').map((t) => t.to)
    for (const target of fromDraft) {
      expect(target).not.toBe('draft')
    }
    expect(fromDraft.length).toBeGreaterThan(0)
  })

  it('never offers a transition out of a terminal state', () => {
    const finance = session(['invoice.issue', 'invoice.void', 'invoice.credit', 'invoice.approve'])
    expect(availableActions(finance, invoiceMachine, 'paid')).toEqual([])
  })
})

/*
  Per-branch permissions — FR-ID-02, A2.

  The pooled set answers "anywhere", and that let an administrator in one
  branch who was read-only in another act as administrator in both.
*/
describe('permissions in a branch', () => {
  const split = {
    permissions: new Set(['admin.users.write', 'job.read']),
    branchRoles: new Map([
      [KUWAIT, 'read_only'],
      [DUBAI, 'administrator'],
    ]),
    branchPermissions: new Map([
      [KUWAIT, new Set(['job.read'])],
      [DUBAI, new Set(['admin.users.write', 'job.read'])],
    ]),
  } as unknown as Session

  it('answers for the branch asked about, not for the pool', () => {
    expect(can(split, 'admin.users.write')).toBe(true)
    expect(canIn(split, 'admin.users.write', DUBAI)).toBe(true)
    expect(canIn(split, 'admin.users.write', KUWAIT)).toBe(false)
    expect(() => assertCanIn(split, 'admin.users.write', KUWAIT)).toThrow(ForbiddenError)
    expect(branchesWhere(split, 'admin.users.write')).toEqual([DUBAI])
  })

  /** QA P2-4: a picker offered Kuwait to someone who only reads it, and the form 500'd. */
  it('narrows a branch picker to the branches the form may act in', () => {
    const choices = [
      { value: KUWAIT, label: 'KWI' },
      { value: DUBAI, label: 'DXB' },
      { value: '00000000-0000-7000-8000-0000000000b9', label: 'QAT' },
    ]
    expect(permittedBranches(split, 'admin.users.write', choices)).toEqual([choices[1]])
    expect(permittedBranches(split, 'job.read', choices)).toEqual([choices[0], choices[1]])
  })

  it('refuses a branch the principal holds no role in at all', () => {
    expect(canIn(split, 'job.read', '00000000-0000-7000-8000-0000000000b9')).toBe(false)
  })

  it('reads a hand-built session as one role everywhere it names', () => {
    const uniform = session(['admin.users.write'], [[KUWAIT, 'administrator']])
    expect(canIn(uniform, 'admin.users.write', KUWAIT)).toBe(true)
    expect(canIn(uniform, 'admin.users.write', DUBAI)).toBe(false)
  })
})
