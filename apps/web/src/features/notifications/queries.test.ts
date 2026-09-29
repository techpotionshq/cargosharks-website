/**
 * The bell on fixtures — the only path a client actually watches.
 *
 * The database path is exercised by the RLS matrix and the dispatcher's own
 * tests; here the thing that matters is the demo, which runs with no database
 * at all. A bell that lit up only against Postgres is a bell nobody in the room
 * ever sees fill, so these assert the fixture keeps the same promises the query
 * does: it is localised, it points somewhere real, and its unread count is the
 * honest number.
 */

import { describe, expect, it } from 'vitest'
import { pilotEnquiries, pilotNotifications } from '@/lib/pilot/fixtures'

describe('pilot notifications', () => {
  it('renders in the reader’s language', () => {
    const en = pilotNotifications('en')
    const ar = pilotNotifications('ar')

    expect(en.length).toBeGreaterThan(0)
    expect(ar).toHaveLength(en.length)

    // Same alerts, different words — a switch to Arabic must carry the bell.
    for (let i = 0; i < en.length; i++) {
      expect(ar[i]!.id).toBe(en[i]!.id)
      expect(ar[i]!.title).not.toBe(en[i]!.title)
    }
  })

  it('points every openable alert at a route, and the rest at nothing', () => {
    for (const item of pilotNotifications('en')) {
      if (item.href === null) continue
      expect(item.href).toMatch(/^\/(jobs|enquiries)\//)
    }
  })

  it('links the SLA breach to the enquiry the queue actually shows overdue', () => {
    const now = Date.now()
    const overdue = pilotEnquiries(now).find(
      (e) => e.firstRespondedAt === null && e.slaDueAt !== null && e.slaDueAt.getTime() < now,
    )
    // The fixture is meant to contain one; if this fails the demo has drifted.
    expect(overdue, 'no overdue enquiry in the fixture').toBeDefined()

    const breach = pilotNotifications('en', now).find((n) => n.eventKey === 'enquiry.sla_breached')
    expect(breach?.href).toBe(`/enquiries/${overdue!.id}`)
  })

  it('leaves some alerts unread, so the badge has something to show', () => {
    const items = pilotNotifications('en')
    expect(items.some((item) => !item.read)).toBe(true)
    expect(items.some((item) => item.read)).toBe(true)
  })
})
