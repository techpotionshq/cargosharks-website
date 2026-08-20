/**
 * The rate-card expiry digest — FR-RT-11.
 *
 * Written at the same time as the handler, because the bug this feature is
 * fixing was not a wrong answer: it was *no answer*, from a job that had been
 * scheduled for months with nothing registered to run it. A suite that proves
 * the worker produces rows is the second half of the fix; the first half is
 * `scripts/check-schedules.mjs`, which proves the worker is reachable.
 *
 * Three of the six cases below are exclusions, and that ratio is deliberate.
 * Anyone can make a digest that lists everything with an end date. The one
 * that gets read is the one that leaves out coverage which has already been
 * renewed, versions that have been superseded, and cards that lapse in three
 * months — and each of those is a silent failure if it goes wrong, because a
 * digest with a wrong count still looks exactly like a digest.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  currencies,
  locations,
  notificationOutbox,
  partners,
  principals,
  rateCards,
  listExpiringRateCards,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { runRateCardExpiryDigest } = await import('./rate-card-expiry')

const BRANCH = '00000000-0000-7000-8000-0000000000d1'
const PRINCIPAL = '00000000-0000-7000-8000-0000000000d2'
const PARTNER = '00000000-0000-7000-8000-0000000000d3'

/** Inside the horizon; the one card the digest should end up naming. */
const SOON = '00000000-0000-7000-8000-0000000000d4'
/** Ninety days out — a renewal nobody has to think about yet. */
const FAR = '00000000-0000-7000-8000-0000000000d5'
/** Lapses inside the horizon, and has already been renewed by `NEXT`. */
const RENEWED = '00000000-0000-7000-8000-0000000000d6'
const NEXT = '00000000-0000-7000-8000-0000000000d7'
/** An old version of a card that was edited — FR-RT-08. */
const SUPERSEDED = '00000000-0000-7000-8000-0000000000d8'

const actor: Actor = { principalId: PRINCIPAL, type: 'system', branchIds: [BRANCH] }

const DAY = 86_400_000

/**
 * A fresh fortnight in the 2030s, picked per run — and the reason is the whole
 * shape of this file.
 *
 * Nothing here is deleted (`DELETE` is revoked from `app_user`), so a suite
 * that pins a date leaves the *evidence of its last run* behind: last night's
 * digest is still in the outbox, and the idempotency guard correctly refuses
 * to announce it again — so the second run of the suite fails, on assertions
 * that are perfectly right, against a worker that is working. The PDF suite
 * next door fails that way today.
 *
 * A per-run window means every run is somebody's first.
 */
const BASE = new Date(Date.UTC(2030, 0, 1) + Math.floor(Math.random() * 3000) * DAY)
const day = (offset: number) => new Date(BASE.getTime() + offset * DAY).toISOString().slice(0, 10)

/** Midday, so the branch's calendar day matches the date in the test. */
const at = (iso: string) => new Date(`${iso}T12:00:00Z`)
const ASOF = at(day(0))

/** The importer's own literal shape — upper bound exclusive (§5, FR-RT-01). */
const range = (from: string, to: string | null) => `[${from},${to ?? ''})`

interface Fixture {
  readonly id: string
  readonly mode: 'sea_fcl' | 'sea_lcl' | 'air' | 'land'
  /** Validity, in days either side of `BASE`. */
  readonly from: number
  readonly to: number
  /** Where this card sits when it is not being tested. */
  readonly slot: number
  readonly over?: Record<string, unknown>
}

const CARDS: readonly Fixture[] = [
  { id: SOON, mode: 'sea_fcl', from: -90, to: 19, slot: 0 },
  { id: FAR, mode: 'sea_lcl', from: -90, to: 92, slot: 1 },
  // The pair: an old card and the renewal that already covers the gap.
  { id: RENEWED, mode: 'air', from: -90, to: 9, slot: 2 },
  { id: NEXT, mode: 'air', from: 9, to: 300, slot: 3 },
  { id: SUPERSEDED, mode: 'land', from: -90, to: 4, slot: 4, over: { supersededById: NEXT } },
]

/**
 * A card's parking window: one day, in 2020, its own.
 *
 * Distinct per card because two of these share a lane, mode and agent —
 * parking both on one range would violate `rate_cards_no_overlap` and fail the
 * teardown rather than the test.
 */
const parked = (slot: number) => ({
  validFrom: `2020-01-${String(1 + slot * 2).padStart(2, '0')}`,
  validTo: `2020-01-${String(2 + slot * 2).padStart(2, '0')}`,
})

/** Digests this run raised, by the night they were compiled for. */
const digestsFor = async (nights: readonly string[]) =>
  (
    await withActor(actor, (tx) =>
      tx
        .select()
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.branchId, BRANCH),
            eq(notificationOutbox.eventKey, 'rate_card.expiring'),
          ),
        ),
    )
  ).filter((row) => nights.includes((row.payload as { asOf?: string }).asOf ?? ''))

const digests = () => digestsFor([day(0)])

/** This suite's cards only. The database is shared with every other suite. */
const mine = async (asOf = ASOF) =>
  (await listExpiringRateCards(actor, asOf)).filter((card) => card.branchId === BRANCH)

describe.skipIf(!enabled)('rate cards about to lapse', () => {
  beforeAll(async () => {
    await withActor(actor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      const ports = await tx
        .select({ id: locations.id })
        .from(locations)
        .orderBy(locations.nameEn)
        .limit(2)
      if (ports.length < 2) throw new Error('Run `pnpm db:seed` before this suite')

      const [usd] = await tx
        .select({ code: currencies.code })
        .from(currencies)
        .where(eq(currencies.code, 'USD'))
        .limit(1)
      if (!usd) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'rate-card-expiry@qabandi.test',
          nameEn: 'Rate Card Expiry Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'RCE',
          legalNameEn: 'Rate Expiry Branch',
          legalNameAr: 'فرع صلاحية الأسعار',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'RCE',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(partners)
        .values({
          id: PARTNER,
          code: 'AGENT-RATE-EXPIRY',
          type: 'agent',
          legalNameEn: 'Expiring Tariff Agent',
          legalNameAr: 'وكيل التعرفة المنتهية',
        })
        .onConflictDoNothing()

      const card = (
        id: string,
        mode: 'sea_fcl' | 'sea_lcl' | 'air' | 'land',
        from: string,
        to: string | null,
        over: Record<string, unknown> = {},
      ) => ({
        id,
        direction: 'buy' as const,
        partnerId: PARTNER,
        branchId: BRANCH,
        mode,
        originId: ports[0]!.id,
        destinationId: ports[1]!.id,
        validity: range(from, to),
        validFrom: from,
        validTo: to,
        currency: 'USD',
        ...over,
      })

      /*
        Created parked, then moved onto this run's window.

        Three steps rather than one because the rows survive the run: the
        insert does nothing on every run after the first, so a suite that
        created them at the right dates and never updated them would test last
        run's window. Parking in between is what makes the move safe — the two
        air cards share a lane and an agent, so shifting one onto a range the
        other still occupies would violate `rate_cards_no_overlap`.
      */
      await tx
        .insert(rateCards)
        .values(
          CARDS.map((fixture) => {
            const slot = parked(fixture.slot)
            return card(fixture.id, fixture.mode, slot.validFrom, slot.validTo, fixture.over)
          }),
        )
        .onConflictDoNothing()

      // Park whatever survived an earlier run before moving anything, so no
      // card is ever shifted onto a range another one still occupies.
      for (const fixture of CARDS) {
        await tx.update(rateCards).set(parked(fixture.slot)).where(eq(rateCards.id, fixture.id))
      }

      for (const fixture of CARDS) {
        await tx
          .update(rateCards)
          .set({ validFrom: day(fixture.from), validTo: day(fixture.to) })
          .where(eq(rateCards.id, fixture.id))
      }
    })
  })

  /*
    Nothing is deleted in this system, so the fixtures stay — but a card valid
    into the 2030s would show as live coverage on every later run of every
    other suite. Parking them in 2020 leaves the rows and their audit trail
    intact and takes them out of everybody else's answer.

    `validity` is not set here: the `rate_cards_validity` trigger derives the
    range from these two columns, which is what keeps the two from ever
    disagreeing.
  */
  afterAll(async () => {
    if (!enabled) return
    await withActor(actor, async (tx) => {
      for (const fixture of CARDS) {
        await tx.update(rateCards).set(parked(fixture.slot)).where(eq(rateCards.id, fixture.id))
      }
    })
  })

  describe('which cards count as expiring', () => {
    it('names a card lapsing inside the horizon', async () => {
      const listed = await mine()

      const soon = listed.find((card) => card.id === SOON)
      expect(soon).toBeDefined()
      // Nineteen days from the night it is compiled. The figure goes in the
      // mail, so it has to be the number of days somebody actually has.
      expect(soon!.daysRemaining).toBe(19)
      expect(soon!.counterparty).toBe('Expiring Tariff Agent')
    })

    it('says nothing about a card that lapses in three months', async () => {
      expect((await mine()).some((card) => card.id === FAR)).toBe(false)
    })

    /**
     * The exclusion that decides whether the digest is worth opening.
     *
     * A tariff renewed last week still has an end date this month, and a mail
     * saying "this lane is about to lose coverage" when the replacement is
     * already on file teaches a pricing desk to filter the sender.
     */
    it('leaves out a lane that has already been renewed', async () => {
      const listed = await mine()

      expect(listed.some((card) => card.id === RENEWED)).toBe(false)
      // The renewal itself is not expiring either — it runs to December.
      expect(listed.some((card) => card.id === NEXT)).toBe(false)
    })

    it('leaves out a superseded version', async () => {
      expect((await mine()).some((card) => card.id === SUPERSEDED)).toBe(false)
    })

    it('names the lane in both languages, and points the arrow both ways', async () => {
      const soon = (await mine()).find((card) => card.id === SOON)!

      expect(soon.lane).toContain('→')
      expect(soon.laneAr).toContain('←')
    })
  })

  describe('the digest itself', () => {
    it('raises one digest for the branch, counting only what is left to do', async () => {
      await runRateCardExpiryDigest(ASOF)

      const raised = await digests()
      expect(raised).toHaveLength(1)

      const payload = raised[0]!.payload as Record<string, string>
      // One: the far card, the renewed lane, its renewal and the superseded
      // version are all excluded.
      expect(payload.count).toBe('1')
      expect(payload.soonest).toBe(day(19))
      expect(payload.horizonDays).toBe('30')
      expect(payload.lanes).toContain('Expiring Tariff Agent')
      expect(payload.lanesAr).toContain('وكيل التعرفة المنتهية')
    })

    /** A schedule that fires twice, or a service restarted mid-run. */
    it('does not raise a second digest the same night', async () => {
      await runRateCardExpiryDigest(ASOF)
      await runRateCardExpiryDigest(ASOF)

      expect(await digests()).toHaveLength(1)
    })

    /**
     * And it does say it again tomorrow, deliberately.
     *
     * Unlike the free-time warning this is not warned-once: the same lane is
     * more urgent every night it goes unrenewed, and a countdown that stops
     * after the first mention is a countdown nobody finishes.
     */
    it('raises the next night as well', async () => {
      await runRateCardExpiryDigest(ASOF)
      await runRateCardExpiryDigest(at(day(1)))

      const raised = await digestsFor([day(0), day(1)])
      expect(raised).toHaveLength(2)
      expect(new Set(raised.map((row) => (row.payload as { asOf: string }).asOf))).toEqual(
        new Set([day(0), day(1)]),
      )
    })

    /**
     * A branch with nothing lapsing gets no mail, not an empty one.
     *
     * Asserted against this branch rather than against the run's totals: the
     * database is shared, and another suite's fixture expiring in 2030 would
     * make a global assertion fail for a reason that has nothing to do with
     * the worker.
     */
    it('says nothing at all when no card of ours is near its end', async () => {
      // A year before this run's window opens: our cards are neither live nor
      // near their end, whatever else the database holds.
      const quiet = at(day(-365))

      expect(await mine(quiet)).toEqual([])
      await runRateCardExpiryDigest(quiet)

      expect(await digestsFor([day(-365)])).toEqual([])
    })
  })
})
