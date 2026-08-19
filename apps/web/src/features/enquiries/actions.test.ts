/**
 * The enquiry's *domain* operations, as against the form adapter beside them.
 *
 * The split is the point of this file. `form-actions.ts` takes a `FormData`
 * and renders a failure against the field that caused it; these take typed
 * input and **throw**, because their callers are not browsers — an inbound
 * email handler or a background job has no field to render an error into, and
 * swallowing a bad transition there would leave the enquiry silently in the
 * wrong state.
 *
 * So every refusal below is asserted as a rejection, deliberately. A test that
 * accepted either shape would let the two halves drift into each other, which
 * is exactly what the split exists to prevent.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { enquiries, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, DESTINATION, HOME_BRANCH, ORIGIN, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { createEnquiry, assignEnquiry, closeEnquiry } = await import('./actions')

function sessionWith(permissions: readonly string[]) {
  return {
    actor: bothBranchesActor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Enquiry Desk',
      nameAr: null,
      email: 'enquiries@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([
      [HOME_BRANCH, 'sales'],
      [AWAY_BRANCH, 'sales'],
    ]),
    requiresTwoFactor: false,
  }
}

const ALL = ['enquiry.assign', 'enquiry.close', 'enquiry.rate']

const input = (extra: Record<string, unknown> = {}) => ({
  branchId: HOME_BRANCH,
  customerId: CUSTOMER,
  channel: 'email',
  mode: 'sea_fcl',
  tradeDirection: 'import',
  ...extra,
})

async function statusOf(id: string): Promise<string> {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx.select({ status: enquiries.status }).from(enquiries).where(eq(enquiries.id, id)),
  )
  return row!.status
}

describe.skipIf(!enabled)('enquiry domain operations', () => {
  beforeAll(async () => {
    await world()
    harness.session = sessionWith(ALL)
  })

  afterAll(() => {
    harness.session = null
  })

  describe('creating', () => {
    it('returns the row it wrote, numbered and new', async () => {
      const row = await createEnquiry(input())

      expect(row.reference).toMatch(/^FXH-ENQ-\d{4}-\d{5}$/)
      expect(row.status).toBe('new')
      expect(row.slaDueAt).toBeInstanceOf(Date)
    })

    /**
     * One sequence across every branch, so a branch's own numbers have gaps —
     * which is fine for a handle people say on the phone and would not be for
     * an invoice series, where a gap reads as a deleted document.
     */
    it('never issues the same number twice', async () => {
      const first = await createEnquiry(input())
      const second = await createEnquiry(input())
      expect(second.reference).not.toBe(first.reference)
    })

    it('numbers an away-branch enquiry with the away branch code', async () => {
      const row = await createEnquiry(input({ branchId: AWAY_BRANCH }))
      expect(row.reference).toMatch(/^FXA-ENQ-/)
    })

    /** Typed input, so a bad shape is a schema error rather than a field error. */
    it('throws on input the schema refuses', async () => {
      await expect(createEnquiry({ branchId: HOME_BRANCH })).rejects.toThrow()
    })

    it('throws on a lane that starts where it ends', async () => {
      await expect(
        createEnquiry(input({ originId: ORIGIN, destinationId: ORIGIN })),
      ).rejects.toThrow()
    })

    it('accepts a lane with two different ends', async () => {
      const row = await createEnquiry(input({ originId: ORIGIN, destinationId: DESTINATION }))
      expect(row.originId).toBe(ORIGIN)
      expect(row.destinationId).toBe(DESTINATION)
    })

    it('refuses a branch the caller does not hold', async () => {
      await expect(
        createEnquiry(input({ branchId: '00000000-0000-7000-8000-0000000000fd' })),
      ).rejects.toThrow('branch:')
    })

    it('refuses a caller without the permission', async () => {
      harness.session = sessionWith([])
      try {
        await expect(createEnquiry(input())).rejects.toThrow('enquiry.assign')
      } finally {
        harness.session = sessionWith(ALL)
      }
    })
  })

  describe('assigning', () => {
    it('hands it to an owner and moves it to assigned', async () => {
      const row = await createEnquiry(input())

      const after = await assignEnquiry({ enquiryId: row.id, ownerId: PRINCIPAL })

      expect(after.status).toBe('assigned')
      expect(after.ownerId).toBe(PRINCIPAL)
    })

    /**
     * Reassignment is allowed, and it is allowed by the machine rather than by
     * an exception around it — `assigned → assigned` is a declared transition
     * (`states.ts`), so this action asserts it unconditionally and still lets
     * the work move to someone else. Worth pinning: handing an enquiry over is
     * an everyday correction, and a machine that refused it would push people
     * back to the database to fix a typo.
     */
    it('reassigns one that is already assigned', async () => {
      const row = await createEnquiry(input())
      await assignEnquiry({ enquiryId: row.id, ownerId: PRINCIPAL })

      const after = await assignEnquiry({ enquiryId: row.id, ownerId: PRINCIPAL })
      expect(after.status).toBe('assigned')
    })

    /** A closed enquiry is terminal — reopening it by assignment is refused. */
    it('refuses to assign one that has been closed', async () => {
      const row = await createEnquiry(input())
      await assignEnquiry({ enquiryId: row.id, ownerId: PRINCIPAL })
      await closeEnquiry({ enquiryId: row.id, outcome: 'lost', reason: 'Went elsewhere' })

      await expect(assignEnquiry({ enquiryId: row.id, ownerId: PRINCIPAL })).rejects.toThrow()
      expect(await statusOf(row.id)).toBe('lost')
    })

    it('treats an invisible enquiry as missing rather than forbidden', async () => {
      await expect(
        assignEnquiry({ enquiryId: '00000000-0000-7000-8000-0000000000fe', ownerId: PRINCIPAL }),
      ).rejects.toThrow('not_found')
    })

    it('throws on an id that is not one', async () => {
      await expect(assignEnquiry({ enquiryId: 'nope', ownerId: PRINCIPAL })).rejects.toThrow()
    })
  })

  describe('closing', () => {
    it('closes an assigned enquiry as lost and keeps the reason', async () => {
      const row = await createEnquiry(input())
      await assignEnquiry({ enquiryId: row.id, ownerId: PRINCIPAL })

      const after = await closeEnquiry({
        enquiryId: row.id,
        outcome: 'lost',
        reason: 'No space on the service',
      })

      expect(after.status).toBe('lost')
      expect(after.lostReason).toBe('No space on the service')
      expect(after.closedAt).toBeInstanceOf(Date)
    })

    /** Nothing was lost, so there is nothing to explain — and nothing stored. */
    it('stores no reason on a win', async () => {
      const row = await createEnquiry(input())
      await withActor({ ...bothBranchesActor, type: 'system' }, (tx) =>
        tx.update(enquiries).set({ status: 'quoted' }).where(eq(enquiries.id, row.id)),
      )

      const after = await closeEnquiry({ enquiryId: row.id, outcome: 'won', reason: 'ignored' })

      expect(after.status).toBe('won')
      expect(after.lostReason).toBeNull()
    })

    /** `won` is reachable only from `quoted` — nobody accepts a price unsent. */
    it('refuses a win on an enquiry nobody has quoted', async () => {
      const row = await createEnquiry(input())
      await assignEnquiry({ enquiryId: row.id, ownerId: PRINCIPAL })

      await expect(closeEnquiry({ enquiryId: row.id, outcome: 'won' })).rejects.toThrow()
      expect(await statusOf(row.id)).toBe('assigned')
    })

    it('refuses an outcome that is neither won nor lost', async () => {
      const row = await createEnquiry(input())
      await expect(closeEnquiry({ enquiryId: row.id, outcome: 'shelved' })).rejects.toThrow()
    })

    it('refuses a caller without the permission', async () => {
      const row = await createEnquiry(input())
      harness.session = sessionWith(['enquiry.assign'])
      try {
        await expect(
          closeEnquiry({ enquiryId: row.id, outcome: 'lost', reason: 'no' }),
        ).rejects.toThrow('enquiry.close')
      } finally {
        harness.session = sessionWith(ALL)
      }
    })

    it('treats an invisible enquiry as missing', async () => {
      await expect(
        closeEnquiry({
          enquiryId: '00000000-0000-7000-8000-0000000000ef',
          outcome: 'lost',
          reason: 'gone',
        }),
      ).rejects.toThrow('not_found')
    })
  })
})
