/**
 * Nightly free-time accrual — FR-JB-08, PP-07, §7.2.
 *
 * SRS §4.2's third commitment is "every cost-bearing event writes a line".
 * This is that commitment implemented as a scheduled pure function rather than
 * an operator's memory: for every running clock, ask `core/clocks.ts` how many
 * days are now chargeable, and write or update the charge line.
 *
 * The engine is in `core` and takes no I/O, so its behaviour over a Kuwaiti
 * weekend, an escalating per-diem and a gate-in date is unit-testable without
 * a database.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { accrue, dec, toDb, type ClockConfig } from '@qabandi/core'
import {
  branches,
  chargeLines,
  chargeTypes,
  freeTimeClocks,
  jobs,
  systemActor,
  withActor,
} from '@qabandi/db'
import { loadCalendars } from './calendars'

export async function runFreeTimeAccrual(
  asOf = new Date(),
): Promise<{ clocks: number; lines: number }> {
  const actor = systemActor()
  let lines = 0

  return withActor(actor, async (tx) => {
    const calendars = await loadCalendars(tx)

    const open = await tx
      .select({
        clock: freeTimeClocks,
        branchId: jobs.branchId,
        calendarId: branches.calendarId,
        baseCurrency: branches.baseCurrency,
      })
      .from(freeTimeClocks)
      .innerJoin(jobs, eq(jobs.id, freeTimeClocks.jobId))
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      .where(isNull(freeTimeClocks.endsOn))

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

      const result = accrue(
        cfg,
        { startedOn: new Date(`${row.clock.startsOn}T00:00:00Z`), endedOn: null },
        calendar,
        asOf,
      )

      if (result.chargeableDays === 0) continue

      // The charge line is keyed to the clock, so a re-run after a crash — or
      // a second run on the same night — updates rather than duplicates.
      const [chargeType] = await tx
        .select({ id: chargeTypes.id })
        .from(chargeTypes)
        .where(eq(chargeTypes.key, row.clock.kind))
        .limit(1)
      if (!chargeType) continue

      const [existing] = await tx
        .select({ id: chargeLines.id })
        .from(chargeLines)
        .where(
          and(
            eq(chargeLines.sourceKind, 'free_time_clock'),
            eq(chargeLines.sourceId, row.clock.id),
          ),
        )
        .limit(1)

      const values = {
        jobId: row.clock.jobId,
        branchId: row.branchId,
        direction: 'cost' as const,
        chargeTypeId: chargeType.id,
        description: `${row.clock.kind} — ${result.chargeableDays} day(s) from ${result.firstChargeableOn}`,
        basis: 'per_day' as const,
        quantity: String(result.chargeableDays),
        rate: row.clock.perDiem,
        amount: toDb(result.amount),
        currency: row.clock.currency,
        // Same-currency accrual keeps the identity rate, so every line carries
        // an FX rate and a timestamp without a special case (FR-RT-06).
        fxRate: '1',
        fxRateAt: asOf,
        amountBase: toDb(result.amount),
        baseCurrency: row.baseCurrency,
        counterpartyPartnerId: row.clock.counterpartyId,
        sourceKind: 'free_time_clock',
        sourceId: row.clock.id,
        isAccrual: true,
      }

      const [line] = existing
        ? await tx
            .update(chargeLines)
            .set(values)
            .where(eq(chargeLines.id, existing.id))
            .returning()
        : await tx.insert(chargeLines).values(values).returning()

      await tx
        .update(freeTimeClocks)
        .set({
          accruedDays: result.chargeableDays,
          accruedAmount: toDb(result.amount),
          lastAccruedAt: asOf,
          chargeLineId: line!.id,
        })
        .where(eq(freeTimeClocks.id, row.clock.id))

      lines++
    }

    return { clocks: open.length, lines }
  })
}
