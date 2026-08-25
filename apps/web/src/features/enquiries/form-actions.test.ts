/**
 * The enquiry queue — where work enters the business.
 *
 * Three properties carry the slice, and each is a decision that could
 * reasonably have gone the other way:
 *
 * **The SLA clock is computed once, at creation, through the branch's own
 * calendar.** Kuwait, Qatar and the UAE share neither a weekend nor a holiday
 * list, so a due time computed against the wrong calendar is wrong by days
 * rather than minutes — and it is stored, not derived on read, so the
 * escalation job every fifteen minutes compares two timestamps instead of
 * recomputing a calendar for every open enquiry.
 *
 * **The first response stops the clock exactly once.** `coalesce` rather than a
 * plain set: a coordinator who replies twice has not answered faster, and a
 * second write would quietly reset the only number the SLA report is about.
 *
 * **A loss must say why.** `lostReason` is the whole point of recording the
 * loss — an enquiry closed `lost` with no reason is a row that tells nobody
 * anything, and this is the only place that answer is ever captured.
 *
 * The outbox row is written in the same transaction as the enquiry. Asserted
 * here rather than assumed, because a notification for a write that rolled
 * back is the failure a transactional outbox exists to make impossible.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { enquiries, notificationOutbox, withActor } = await import('@qabandi/db')

const {
  AWAY_BRANCH,
  CUSTOMER,
  DESTINATION,
  HOME_BRANCH,
  ORIGIN,
  PRINCIPAL,
  bothBranchesActor,
  world,
} = await import('@/lib/testing/fixtures')

const { submitEnquiry, assignEnquiryAction, respondEnquiryAction, closeEnquiryAction } =
  await import('./form-actions')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Enquiry Desk',
    nameAr: null,
    email: 'enquiries@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['enquiry.assign', 'enquiry.close', 'enquiry.rate']),
  branchRoles: new Map([
    [HOME_BRANCH, 'sales'],
    [AWAY_BRANCH, 'sales'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const enquiryForm = (extra: Record<string, string> = {}) =>
  form({
    branchId: HOME_BRANCH,
    customerId: CUSTOMER,
    channel: 'email',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    ...extra,
  })

/**
 * One named enquiry, by id.
 *
 * Deliberately not "the most recent one in this branch": the sibling suites in
 * this slice write home-branch enquiries too, they run in parallel, and
 * "newest" was sometimes theirs. `submitEnquiry` hands back the reference it
 * allocated, which is the only handle that identifies the row it wrote.
 */
async function readEnquiry(id: string) {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({
        id: enquiries.id,
        reference: enquiries.reference,
        status: enquiries.status,
        ownerId: enquiries.ownerId,
        slaStartedAt: enquiries.slaStartedAt,
        slaDueAt: enquiries.slaDueAt,
        firstRespondedAt: enquiries.firstRespondedAt,
        lostReason: enquiries.lostReason,
        closedAt: enquiries.closedAt,
      })
      .from(enquiries)
      .where(eq(enquiries.id, id))
      .limit(1),
  )
  return row!
}

/** Raises one and reads back exactly the row it raised. */
async function raise(extra: Record<string, string> = {}) {
  const state = await submitEnquiry({}, enquiryForm(extra))
  expect(state.errors).toBeUndefined()

  // `succeed(reference)` returns `"<reference>:<sequence>"` — the counter that
  // makes two identical successes distinguishable to React.
  const reference = String(state.ok).replace(/:\d+$/, '')
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx.select({ id: enquiries.id }).from(enquiries).where(eq(enquiries.reference, reference)),
  )
  return readEnquiry(row!.id)
}

describe.skipIf(!enabled)('the enquiry queue', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  describe('taking an enquiry', () => {
    it('raises one and numbers it', async () => {
      const row = await raise()

      // `FXH-ENQ-2026-00001` — branch, kind, year, sequence.
      expect(row.reference).toMatch(/^FXH-ENQ-\d{4}-\d{5}$/)
      expect(row.status).toBe('new')
    })

    /**
     * One sequence across every branch, so a branch's own numbers have gaps —
     * fine for a handle people say on the phone, and not fine for an invoice
     * series where a gap reads as a deleted document (FR-ID-01).
     *
     * This and the away-branch case below moved here when the duplicate
     * `actions.ts` was removed: both cover `nextReference`, which that file
     * carried its own copy of, and this is now the only copy.
     */
    it('never issues the same number twice', async () => {
      const first = await raise()
      const second = await raise()

      expect(second.reference).not.toBe(first.reference)
    })

    it('numbers an away-branch enquiry with the away branch code', async () => {
      const row = await raise({ branchId: AWAY_BRANCH })

      expect(row.reference).toMatch(/^FXA-ENQ-/)
    })

    /**
     * The clock is stored, not derived. Four working hours from now through
     * the branch's calendar, which is never four wall-clock hours across a
     * weekend.
     */
    it('starts the SLA clock and stores when it is due', async () => {
      const row = await raise()

      expect(row.slaStartedAt).toBeInstanceOf(Date)
      expect(row.slaDueAt).toBeInstanceOf(Date)
      expect(row.slaDueAt!.getTime()).toBeGreaterThan(row.slaStartedAt!.getTime())
    })

    it('writes the outbox row in the same transaction', async () => {
      const row = await raise()

      const events = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ key: notificationOutbox.eventKey })
          .from(notificationOutbox)
          .where(eq(notificationOutbox.enquiryId, row.id)),
      )
      expect(events.map((event) => event.key)).toContain('enquiry.created')
    })

    /**
     * A lead from a company nobody has shipped for is the normal state of a new
     * enquiry (FR-EQ-02), so a contact email stands in for a customer row.
     */
    it('accepts a lead with a contact email and no customer', async () => {
      const state = await submitEnquiry(
        {},
        form({
          branchId: HOME_BRANCH,
          contactName: 'Yousef Al-Sabah',
          contactEmail: 'yousef@example.com',
          channel: 'email',
        }),
      )
      expect(state.errors).toBeUndefined()
    })

    it('refuses one with neither a customer nor a way to reply', async () => {
      const state = await submitEnquiry({}, form({ branchId: HOME_BRANCH, channel: 'email' }))
      expect(state.errors?.customerId).toBeDefined()
    })

    /** A lane with the same port at both ends is a typing mistake, every time. */
    it('refuses a lane that starts where it ends', async () => {
      const state = await submitEnquiry(
        {},
        enquiryForm({ originId: ORIGIN, destinationId: ORIGIN }),
      )
      expect(state.errors?.destinationId).toBeDefined()
    })

    it('accepts a lane with two different ends', async () => {
      const state = await submitEnquiry(
        {},
        enquiryForm({ originId: ORIGIN, destinationId: DESTINATION }),
      )
      expect(state.errors).toBeUndefined()
    })

    it('records the cargo figures and the dangerous-goods flag', async () => {
      const raised = await raise({
        grossWeightKg: '2400.500',
        volumeCbm: '18.750',
        pieces: '12',
        isDangerous: 'on',
      })

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            weight: enquiries.grossWeightKg,
            volume: enquiries.volumeCbm,
            pieces: enquiries.pieces,
            dangerous: enquiries.isDangerous,
          })
          .from(enquiries)
          .where(eq(enquiries.id, raised.id)),
      )
      expect(Number(row!.weight)).toBeCloseTo(2400.5, 3)
      expect(row!.pieces).toBe(12)
      expect(row!.dangerous).toBe(true)
    })

    /** An unchecked box arrives absent, not as `false` — the usual HTML trap. */
    it('reads an absent dangerous-goods box as not dangerous', async () => {
      const row = await raise()
      const [stored] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ dangerous: enquiries.isDangerous })
          .from(enquiries)
          .where(eq(enquiries.id, row.id)),
      )
      expect(stored!.dangerous).toBe(false)
    })

    it('refuses a branch the desk does not hold', async () => {
      await expect(
        submitEnquiry({}, enquiryForm({ branchId: '00000000-0000-7000-8000-0000000000fb' })),
      ).rejects.toThrow('branch:')
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      expect((await submitEnquiry({}, form({}))).errors).toBeDefined()
    })
  })

  describe('handing it to someone', () => {
    it('assigns a new enquiry and moves it on', async () => {
      const row = await raise()

      const state = await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      expect(state.errors).toBeUndefined()
      const after = await readEnquiry(row.id)
      expect(after.status).toBe('assigned')
      expect(after.ownerId).toBe(PRINCIPAL)
    })

    /**
     * Reassignment is not a transition. The machine governs the first move out
     * of `new`; after that, handing the work to someone else is an everyday
     * correction and refusing it would send people back to the database.
     */
    it('reassigns an assigned enquiry without refusing it', async () => {
      const row = await raise()
      await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      const again = await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      expect(again.errors).toBeUndefined()
      expect((await readEnquiry(row.id)).status).toBe('assigned')
    })

    it('asks who should own it when nobody was chosen', async () => {
      const row = await raise()
      const state = await assignEnquiryAction({}, form({ enquiryId: row.id }))
      expect(state.errors?.ownerId).toBeDefined()
    })

    /** Invisible under RLS is not-found, not forbidden — no enumeration signal. */
    it('treats an enquiry in nobody’s branch as missing', async () => {
      await expect(
        assignEnquiryAction(
          {},
          form({ enquiryId: '00000000-0000-7000-8000-0000000000fc', ownerId: PRINCIPAL }),
        ),
      ).rejects.toThrow('not_found')
    })
  })

  describe('stopping the clock', () => {
    it('records the first reply', async () => {
      const row = await raise()
      expect(row.firstRespondedAt).toBeNull()

      const state = await respondEnquiryAction({}, form({ enquiryId: row.id }))

      expect(state.errors).toBeUndefined()
      expect((await readEnquiry(row.id)).firstRespondedAt).toBeInstanceOf(Date)
    })

    /**
     * `coalesce`, not a plain set. Replying twice does not make the answer
     * faster, and overwriting would silently improve the only number the SLA
     * report is about.
     */
    it('keeps the first reply time when someone replies again', async () => {
      const row = await raise()
      await respondEnquiryAction({}, form({ enquiryId: row.id }))
      const first = (await readEnquiry(row.id)).firstRespondedAt

      await respondEnquiryAction({}, form({ enquiryId: row.id }))

      expect((await readEnquiry(row.id)).firstRespondedAt?.getTime()).toBe(first?.getTime())
    })

    it('says so plainly when no enquiry was named', async () => {
      expect((await respondEnquiryAction({}, form({}))).errors).toBeDefined()
    })
  })

  describe('closing it', () => {
    it('closes an assigned enquiry as lost, with the reason', async () => {
      const row = await raise()
      await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      const state = await closeEnquiryAction(
        {},
        form({ enquiryId: row.id, outcome: 'lost', reason: 'Rate beaten by the incumbent' }),
      )

      expect(state.errors).toBeUndefined()
      const after = await readEnquiry(row.id)
      expect(after.status).toBe('lost')
      expect(after.lostReason).toBe('Rate beaten by the incumbent')
      expect(after.closedAt).toBeInstanceOf(Date)
    })

    /** The reason is the data. A loss with no reason tells nobody anything. */
    it('refuses a loss with no reason', async () => {
      const row = await raise()
      const state = await closeEnquiryAction({}, form({ enquiryId: row.id, outcome: 'lost' }))

      expect(state.errors?.reason).toBeDefined()
      expect((await readEnquiry(row.id)).status).toBe('new')
    })

    it('insists on won or lost, not something else', async () => {
      const row = await raise()
      const state = await closeEnquiryAction(
        {},
        form({ enquiryId: row.id, outcome: 'maybe', reason: 'unsure' }),
      )
      expect(state.errors?.outcome).toBeDefined()
    })

    /**
     * `won` is only reachable from `quoted` — a customer cannot accept a price
     * nobody sent them. The machine refuses it and the action lets that throw
     * rather than dressing a broken screen up as a field error.
     */
    it('refuses a win on an enquiry nobody has quoted', async () => {
      const row = await raise()
      await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      await expect(
        closeEnquiryAction({}, form({ enquiryId: row.id, outcome: 'won' })),
      ).rejects.toThrow()
    })

    it('records a win once the price has been quoted', async () => {
      const row = await raise()
      await withActor({ ...bothBranchesActor, type: 'system' }, (tx) =>
        tx.update(enquiries).set({ status: 'quoted' }).where(eq(enquiries.id, row.id)),
      )

      const state = await closeEnquiryAction({}, form({ enquiryId: row.id, outcome: 'won' }))

      expect(state.errors).toBeUndefined()
      const after = await readEnquiry(row.id)
      expect(after.status).toBe('won')
      // Nothing was lost, so there is nothing to explain.
      expect(after.lostReason).toBeNull()
    })
  })
})
