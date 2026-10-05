/**
 * Staff notification routing — run 5, R12.
 *
 * One enquiry in a branch of 49 staff produced 98 deliveries: every person,
 * email and bell, whatever their role. These prove the ladder that replaced
 * it: the record's owner, else the responsible roles, else administrators,
 * else everyone (so an alarm is never addressed to nobody).
 */

import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_EVENTS,
  STAFF_ROUTING,
  staffAudience,
  staffEmailMuted,
  staffRouting,
  type StaffCandidate,
} from '../src/index'

/** Run 5's Kuwait branch, near enough: 49 staff, most of them not on the desk. */
function branchOf49(): StaffCandidate[] {
  const staff: StaffCandidate[] = [
    { principalId: 'admin', roleKey: 'administrator' },
    { principalId: 'noura', roleKey: 'operations_manager' },
    { principalId: 'khalid', roleKey: 'operations_manager' },
    { principalId: 'fatima', roleKey: 'finance' },
    { principalId: 'omar', roleKey: 'finance' },
    { principalId: 'sara', roleKey: 'coordinator' },
    { principalId: 'yaqoub', roleKey: 'sales' },
    { principalId: 'reem', roleKey: 'read_only' },
    { principalId: 'hamad', roleKey: 'customs_broker' },
  ]
  const roles = ['coordinator', 'sales', 'read_only']
  for (let i = 0; i < 40; i += 1) {
    staff.push({ principalId: `load${i}`, roleKey: roles[i % 3]! })
  }
  return staff
}

describe('who hears about a new enquiry', () => {
  it('reaches only operations management and sales in a branch of 49, not all 49', () => {
    const staff = branchOf49()
    expect(staff).toHaveLength(49)
    const told = staffAudience('enquiry.created', staff, null)
    const roles = new Set(told.map((id) => staff.find((s) => s.principalId === id)!.roleKey))
    expect([...roles].sort()).toEqual(['operations_manager', 'sales'])
    for (const nobody of ['admin', 'fatima', 'omar', 'reem', 'hamad', 'sara']) {
      expect(told).not.toContain(nobody)
    }
  })

  it('reaches only the owner once the enquiry has one', () => {
    expect(staffAudience('enquiry.created', branchOf49(), 'sara')).toEqual(['sara'])
  })

  it('ignores an owner who no longer works in the branch', () => {
    const told = staffAudience('enquiry.created', branchOf49(), 'left-the-company')
    expect(told).toContain('noura')
    expect(told).not.toContain('left-the-company')
  })

  it('escalates an SLA breach to the desk as well as the owner', () => {
    const told = staffAudience('enquiry.sla_breached', branchOf49(), 'sara')
    expect(told).toContain('sara')
    expect(told).toContain('noura')
    expect(told).not.toContain('fatima')
  })
})

describe('the other groups', () => {
  it('sends a supplier variance to finance only, not to the job owner', () => {
    expect(staffAudience('supplier_invoice.variance_flagged', branchOf49(), 'sara').sort()).toEqual(
      ['fatima', 'omar'],
    )
  })

  it('sends a job exception to its owner', () => {
    expect(staffAudience('exception.opened', branchOf49(), 'sara')).toEqual(['sara'])
  })
})

describe('never addressed to nobody', () => {
  it('falls back to the branch administrators when no one holds the role', () => {
    const staff = [
      { principalId: 'a', roleKey: 'administrator' },
      { principalId: 'r', roleKey: 'read_only' },
    ]
    expect(staffAudience('supplier_invoice.variance_flagged', staff, null)).toEqual(['a'])
  })

  it('falls back to everyone when there is not even an administrator', () => {
    const staff = [
      { principalId: 'c', roleKey: 'coordinator' },
      { principalId: 'r', roleKey: 'read_only' },
    ]
    expect(staffAudience('enquiry.created', staff, null).sort()).toEqual(['c', 'r'])
  })
})

describe('the declarations', () => {
  it('routes every internal event, and only internal ones', () => {
    for (const event of NOTIFICATION_EVENTS) {
      if (event.audience === 'internal') expect(STAFF_ROUTING[event.key], event.key).toBeDefined()
      else expect(staffRouting(event.key)).toBeNull()
    }
    for (const key of Object.keys(STAFF_ROUTING)) {
      expect(NOTIFICATION_EVENTS.find((e) => e.key === key)?.audience, key).toBe('internal')
    }
  })

  it('mutes email by group, and never for a customer event', () => {
    expect(staffEmailMuted('enquiry.created', ['enquiries'])).toBe(true)
    expect(staffEmailMuted('enquiry.created', ['finance'])).toBe(false)
    expect(staffEmailMuted('invoice.issued', ['enquiries', 'finance'])).toBe(false)
  })
})
