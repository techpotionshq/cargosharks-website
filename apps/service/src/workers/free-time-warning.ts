/**
 * Free time, warned before it costs — FR-JB-08, nightly.
 *
 * The accrual beside this one bills demurrage the night after it is incurred,
 * which is accounting and is correct. It is also the wrong direction to be
 * facing: the only days anybody can act on are the ones before the clock
 * starts, and a container moved on day four costs nothing at all. Billing a
 * customer accurately for a cost we could have avoided is a feature of the
 * ledger; avoiding it is a feature of the product.
 *
 * ## Why this is a second worker rather than a branch in the accrual
 *
 * They run at different times for different people. The accrual runs late and
 * writes charge lines nobody reads until month end. This runs early enough
 * that a coordinator can still book a haulier, and it writes to an inbox. They
 * also fail differently — a warning that does not send is a cost we will
 * discover; an accrual that does not run is a number that is merely late.
 *
 * They share `loadCalendars` and `core/clocks.ts`, which is the part that must
 * not drift: a warning saying four days against a bill charging from day three
 * teaches the coordinator to stop trusting the warning.
 *
 * ## Warned once
 *
 * `warned_at` is the same mechanism as `enquiries.escalated_at`, for the same
 * reason. A warning that arrives every night for three nights is a warning
 * that gets a mail rule written against it, and then the fourth container is
 * the one nobody sees.
 */

import { and, eq, isNull } from 'drizzle-orm'
import {
  FREE_TIME_WARNING_DAYS,
  dec,
  freeTimeExpiresOn,
  freeTimeRemaining,
  type ClockConfig,
} from '@qabandi/core'
import {
  branches,
  equipment,
  freeTimeClocks,
  jobs,
  notificationOutbox,
  systemActor,
  withActor,
} from '@qabandi/db'
import { loadCalendars } from './calendars'

export async function runFreeTimeWarnings(
  asOf = new Date(),
  warnWithinDays = FREE_TIME_WARNING_DAYS,
): Promise<{ examined: number; warned: number }> {
  return withActor(systemActor(), async (tx) => {
    const calendars = await loadCalendars(tx)

    const open = await tx
      .select({
        clock: freeTimeClocks,
        jobId: jobs.id,
        reference: jobs.reference,
        branchId: jobs.branchId,
        customerId: jobs.customerId,
        calendarId: branches.calendarId,
        containerNo: equipment.containerNo,
      })
      .from(freeTimeClocks)
      .innerJoin(jobs, eq(jobs.id, freeTimeClocks.jobId))
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      /*
        Left, not inner. A storage clock runs against loose cargo with no
        container at all, and an inner join would silently drop exactly the
        LCL and air consignments this is meant to cover.
      */
      .leftJoin(equipment, eq(equipment.id, freeTimeClocks.equipmentId))
      .where(and(isNull(freeTimeClocks.endsOn), isNull(freeTimeClocks.warnedAt)))

    let warned = 0

    for (const row of open) {
      const calendar = calendars.get(row.calendarId)
      if (!calendar) continue

      const cfg: ClockConfig = {
        kind: row.clock.kind,
        freeDays: row.clock.freeDays,
        perDiem: dec(row.clock.perDiem),
        currency: row.clock.currency,
        dayBasis: row.clock.dayBasis,
        tiers: row.clock.tiers?.map((t) => ({ fromDay: t.fromDay, perDiem: dec(t.perDiem) })),
      }

      const window = { startedOn: new Date(`${row.clock.startsOn}T00:00:00Z`), endedOn: null }
      const daysRemaining = freeTimeRemaining(cfg, window, calendar, asOf)

      if (daysRemaining > warnWithinDays) continue

      /*
        Zero remaining still warns, and this is the case worth being deliberate
        about.

        A clock entered after its free time had already lapsed — backdated
        gate-in, a late data entry, a shipment inherited mid-move — never
        counts down through three, two, one. Warning only on the way down would
        leave exactly those silent, and they are the expensive ones. The
        template carries `daysRemaining` so the wording can be honest about
        which case it is.
      */
      await tx
        .update(freeTimeClocks)
        .set({ warnedAt: asOf })
        .where(eq(freeTimeClocks.id, row.clock.id))

      await tx.insert(notificationOutbox).values({
        branchId: row.branchId,
        eventKey: 'free_time.expiring',
        jobId: row.jobId,
        /*
          The customer is named on the row and the event is internal, so this
          is context for whoever picks it up, not an address. `notifications.ts`
          decides the audience from the event key and nothing else — which is
          the hole its own header describes closing.
        */
        customerId: row.customerId,
        payload: {
          reference: row.reference,
          kind: row.clock.kind,
          containerNo: row.containerNo ?? '—',
          daysRemaining: String(daysRemaining),
          expiresOn: freeTimeExpiresOn(cfg, window, calendar),
          perDiem: row.clock.perDiem,
          currency: row.clock.currency,
        },
      })

      warned++
    }

    return { examined: open.length, warned }
  })
}

/**
 * Clocks that will start charging soon, for the operations board.
 *
 * The same question the worker asks, answered without writing anything, so a
 * screen can show the badge without waiting for the night's run — and so the
 * board and the email cannot disagree about which containers are at risk.
 */
export async function listExpiringFreeTime(
  asOf = new Date(),
  withinDays = FREE_TIME_WARNING_DAYS,
): Promise<
  {
    jobId: string
    reference: string
    kind: string
    containerNo: string | null
    daysRemaining: number
    expiresOn: string
    perDiem: string
    currency: string
  }[]
> {
  return withActor(systemActor(), async (tx) => {
    const calendars = await loadCalendars(tx)

    const open = await tx
      .select({
        clock: freeTimeClocks,
        jobId: jobs.id,
        reference: jobs.reference,
        calendarId: branches.calendarId,
        containerNo: equipment.containerNo,
      })
      .from(freeTimeClocks)
      .innerJoin(jobs, eq(jobs.id, freeTimeClocks.jobId))
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      .leftJoin(equipment, eq(equipment.id, freeTimeClocks.equipmentId))
      .where(isNull(freeTimeClocks.endsOn))

    const rows = []
    for (const row of open) {
      const calendar = calendars.get(row.calendarId)
      if (!calendar) continue

      const cfg: ClockConfig = {
        kind: row.clock.kind,
        freeDays: row.clock.freeDays,
        perDiem: dec(row.clock.perDiem),
        currency: row.clock.currency,
        dayBasis: row.clock.dayBasis,
      }
      const window = { startedOn: new Date(`${row.clock.startsOn}T00:00:00Z`), endedOn: null }
      const daysRemaining = freeTimeRemaining(cfg, window, calendar, asOf)
      if (daysRemaining > withinDays) continue

      rows.push({
        jobId: row.jobId,
        reference: row.reference,
        kind: row.clock.kind,
        containerNo: row.containerNo,
        daysRemaining,
        expiresOn: freeTimeExpiresOn(cfg, window, calendar),
        perDiem: row.clock.perDiem,
        currency: row.clock.currency,
      })
    }

    return rows.sort((a, b) => a.daysRemaining - b.daysRemaining)
  })
}
