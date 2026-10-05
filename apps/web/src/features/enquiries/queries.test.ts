/**
 * The enquiry queue's reads.
 *
 * The list has one job — put the thing that will hurt at the top — so the
 * ordering and the two "only show me" filters carry more weight than the
 * columns. What is asserted below is mostly what each filter *leaves out*: a
 * predicate that matches everything is indistinguishable from a working one
 * unless something that should be excluded is present to be excluded.
 *
 * No query here carries a branch condition, and that absence is the design: a
 * `where branch_id = ?` would be a second, forgettable copy of a rule RLS
 * already enforces. It is proved rather than asserted — the away branch has
 * rows, and they do not appear for an actor who does not hold it.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { enquiries, quotes, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PRINCIPAL, bothBranchesActor, homeActor, world } =
  await import('@/lib/testing/fixtures')

const { countEnquiries, listEnquiries, getEnquiry } = await import('./queries')

const systemActor = { ...bothBranchesActor, type: 'system' as const }

let seq = 0
const RUN = Date.now().toString(36).toUpperCase()

/**
 * A due time old enough to sort first, and the reason these rows are findable
 * at all.
 *
 * The queue orders by `slaDueAt` ascending, and nothing is ever deleted — so
 * every previous run's enquiries sit in the page ahead of anything seeded
 * with no clock, and a fixture row eventually falls off the end. Sharing one
 * ancient timestamp puts every row this file writes in the same leading group,
 * where the `createdAt desc` tiebreak keeps the newest — this run's — on top.
 */
const SORTS_FIRST = new Date('2000-01-01T00:00:00.000Z')

/** An enquiry written directly, so its clock and owner can be posed exactly. */
async function seed(values: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `FXH-ENQ-Q${RUN}-${seq}`,
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        channel: 'email',
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'new',
        slaDueAt: SORTS_FIRST,
        ...values,
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

const WIDE = { page: 1, size: 200 }
const find = async (id: string, filters = {}) =>
  (await listEnquiries(bothBranchesActor, filters, 'en', WIDE)).rows.find((row) => row.id === id)

describe.skipIf(!enabled)('the enquiry queue’s reads', () => {
  beforeAll(async () => {
    await world()
  })

  describe('what a row says', () => {
    /**
     * The branch is joined, not sliced out of the reference. It read
     * `reference.split('-')[1]`, which is the branch in the pilot fixtures
     * (`ENQ-KWI-…`) and the literal string `ENQ` on a real database
     * (`KWI-ENQ-…`).
     */
    it('names the branch, not the letters ENQ', async () => {
      const id = await seed()
      expect((await find(id))?.branchCode).toBe('FXH')
    })

    /**
     * A company nobody has shipped for has no customer row, and that is the
     * normal state of a new lead (FR-EQ-02) rather than missing data — falling
     * straight to an em-dash rendered the most interesting row in the queue as
     * anonymous.
     */
    it('falls back through contact name and email before giving up', async () => {
      const named = await seed({
        customerId: null,
        contactName: 'Noura Al-Mutairi',
        contactEmail: 'noura@example.com',
      })
      const emailOnly = await seed({
        customerId: null,
        contactName: null,
        contactEmail: 'anon@example.com',
      })

      expect((await find(named))?.customerName).toBe('Noura Al-Mutairi')
      expect((await find(emailOnly))?.customerName).toBe('anon@example.com')
    })

    it('uses the customer’s name where there is one', async () => {
      const id = await seed()
      expect((await find(id))?.customerName).toBe('Fixture Home Customer')
    })

    it('renders a lane with no ports as em-dashes rather than blanks', async () => {
      const id = await seed()
      const row = await find(id)
      expect(row?.originName).toBe('—')
      expect(row?.destinationName).toBe('—')
    })
  })

  describe('the quoted price on a row', () => {
    async function quoteFor(enquiryId: string, sell: string, cost: string, currency = 'KWD') {
      await withActor(systemActor, (tx) =>
        tx.insert(quotes).values({
          reference: `FXH-QUO-Q${RUN}-${(seq += 1)}`,
          enquiryId,
          branchId: HOME_BRANCH,
          currency,
          totalSell: sell,
          totalCost: cost,
        }),
      )
    }

    /** The quote's own currency — every row said KWD (S16). */
    it('labels the price in the quotation’s currency', async () => {
      const id = await seed()
      await quoteFor(id, '1000.00', '750.00', 'AED')

      expect((await find(id))?.quotedSell?.currency).toBe('AED')
    })

    it('carries the margin as a percentage of the sell', async () => {
      const id = await seed()
      await quoteFor(id, '1000.000', '750.000')

      const row = await find(id)
      expect(row?.quotedSell?.amount).toBeCloseTo(1000, 3)
      expect(row?.quotedMargin).toBeCloseTo(25, 1)
    })

    /** Dividing by a zero sell would give Infinity, which renders as nonsense. */
    it('reports no margin on a quote priced at nothing', async () => {
      const id = await seed()
      await quoteFor(id, '0.000', '0.000')
      expect((await find(id))?.quotedMargin).toBeNull()
    })

    it('reports no price at all where nothing has been quoted', async () => {
      const id = await seed()
      const row = await find(id)
      expect(row?.quotedSell).toBeNull()
      expect(row?.quotedMargin).toBeNull()
    })

    /**
     * The current quote only. A superseded revision is not this enquiry's
     * price, and joining it would show the customer a figure that was
     * withdrawn.
     */
    it('ignores a superseded revision', async () => {
      const id = await seed()
      await quoteFor(id, '900.000', '600.000')

      const [current] = await withActor(systemActor, (tx) =>
        tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.enquiryId, id)),
      )
      await withActor(systemActor, (tx) =>
        tx
          .update(quotes)
          .set({ status: 'superseded', supersededById: current!.id })
          .where(eq(quotes.id, current!.id)),
      )

      expect((await find(id))?.quotedSell).toBeNull()
    })
  })

  describe('filters', () => {
    it('treats open as the working set rather than one status', async () => {
      const open = await seed({ status: 'assigned' })
      const closed = await seed({ status: 'lost', lostReason: 'Went elsewhere' })

      expect(await find(open, { status: 'open' })).toBeDefined()
      expect(await find(closed, { status: 'open' })).toBeUndefined()
    })

    it('filters by one explicit status, excluding the rest', async () => {
      const quoted = await seed({ status: 'quoted' })
      const fresh = await seed({ status: 'new' })

      expect(await find(quoted, { status: 'quoted' })).toBeDefined()
      expect(await find(fresh, { status: 'quoted' })).toBeUndefined()
    })

    it('filters to one owner', async () => {
      const mine = await seed({ ownerId: PRINCIPAL, status: 'assigned' })
      const nobodys = await seed()

      expect(await find(mine, { ownerId: PRINCIPAL })).toBeDefined()
      expect(await find(nobodys, { ownerId: PRINCIPAL })).toBeUndefined()
    })

    /** The board's triage view: what nobody has picked up yet. */
    it('shows only the unassigned when asked', async () => {
      const owned = await seed({ ownerId: PRINCIPAL, status: 'assigned' })
      const orphan = await seed()

      expect(await find(orphan, { unassignedOnly: true })).toBeDefined()
      expect(await find(owned, { unassignedOnly: true })).toBeUndefined()
    })

    /**
     * Overdue is two facts, not one: the clock has run out **and** nobody has
     * replied. An enquiry answered late is not still overdue, and treating it
     * as one would keep it on the escalation board for ever.
     */
    it('counts an unanswered enquiry past its due time as overdue', async () => {
      const breached = await seed({ firstRespondedAt: null })
      const answered = await seed({ firstRespondedAt: new Date() })
      const inTime = await seed({ slaDueAt: new Date(Date.now() + 60 * 60 * 1000) })

      expect(await find(breached, { overdueOnly: true })).toBeDefined()
      expect(await find(answered, { overdueOnly: true })).toBeUndefined()
      expect(await find(inTime, { overdueOnly: true })).toBeUndefined()
    })

    it('pages at the size asked for, and reports the whole total', async () => {
      const page = await listEnquiries(bothBranchesActor, {}, 'en', { page: 1, size: 3 })
      expect(page.rows.length).toBeLessThanOrEqual(3)
      expect(page.total).toBeGreaterThanOrEqual(page.rows.length)
    })

    it('returns nothing for a status nothing holds', async () => {
      const none = await listEnquiries(bothBranchesActor, { status: 'cancelled' })
      expect(none.rows).toEqual([])
      expect(none.total).toBe(0)
    })
  })

  describe('paging', () => {
    /*
      Replaces a keyset test for a cursor no screen used: it continued by
      creation time while the queue sorts by deadline. Offset pages now, as
      every register does, and the property that matters is that page two
      neither repeats page one nor disagrees with it about the total.
    */
    it('reaches page two without repeating page one', async () => {
      const one = await listEnquiries(bothBranchesActor, {}, 'en', { page: 1, size: 3 })
      const two = await listEnquiries(bothBranchesActor, {}, 'en', { page: 2, size: 3 })

      expect(one.total).toBeGreaterThan(3)
      expect(two.total).toBe(one.total)
      expect(two.rows.length).toBeGreaterThan(0)
      const firstIds = new Set(one.rows.map((row) => row.id))
      expect(two.rows.some((row) => firstIds.has(row.id))).toBe(false)
    })

    it('counts the open queue as the open filter pages through it', async () => {
      const counts = await countEnquiries(homeActor)
      const open = await listEnquiries(homeActor, { status: 'open' }, 'en', { page: 1, size: 1 })
      const unassigned = await listEnquiries(
        homeActor,
        { status: 'open', unassignedOnly: true },
        'en',
        { page: 1, size: 1 },
      )

      expect(counts.open).toBe(open.total)
      expect(counts.unassigned).toBe(unassigned.total)
    })
  })

  describe('scoping — FR-ID-04', () => {
    it('hides another branch’s enquiry from the list', async () => {
      const away = await withActor(systemActor, async (tx) => {
        const [row] = await tx
          .insert(enquiries)
          .values({
            reference: `FXA-ENQ-Q${RUN}-${(seq += 1)}`,
            branchId: AWAY_BRANCH,
            channel: 'email',
            contactEmail: 'away@example.com',
            status: 'new',
            slaDueAt: SORTS_FIRST,
          })
          .returning({ id: enquiries.id })
        return row!.id
      })

      const visible = await listEnquiries(homeActor, {}, 'en', WIDE)
      expect(visible.rows.map((row) => row.id)).not.toContain(away)

      const both = await listEnquiries(bothBranchesActor, {}, 'en', WIDE)
      expect(both.rows.map((row) => row.id)).toContain(away)
    })

    /** Not-found rather than forbidden: no enumeration signal. */
    it('returns nothing for a single enquiry in another branch', async () => {
      const away = await withActor(systemActor, async (tx) => {
        const [row] = await tx
          .insert(enquiries)
          .values({
            reference: `FXA-ENQ-Q${RUN}-${(seq += 1)}`,
            branchId: AWAY_BRANCH,
            channel: 'email',
            contactEmail: 'away2@example.com',
            status: 'new',
            slaDueAt: SORTS_FIRST,
          })
          .returning({ id: enquiries.id })
        return row!.id
      })

      expect(await getEnquiry(homeActor, away)).toBeUndefined()
      expect((await getEnquiry(bothBranchesActor, away))?.id).toBe(away)
    })

    /*
      Asserted on `reference` rather than on a column like `notes`, and not by
      preference: `getEnquiry` returns the whole enquiry row on a database and
      an `EnquirySummary` under `usePilotFixtures()`, so its type is the union
      of the two and only the fields common to both are reachable. Worth
      knowing before reaching for a column that exists on the table.
    */
    it('reads one back by id', async () => {
      const id = await seed()
      const row = await getEnquiry(bothBranchesActor, id)

      expect(row?.id).toBe(id)
      expect(row?.reference).toMatch(/^FXH-ENQ-/)
    })
  })
})
