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
 *
 * ## A stopped clock is settled once more, at its end
 *
 * Only open clocks used to be read, so the night a container was returned the
 * clock dropped out of the sweep with whatever it had accrued the night before
 * — and a return entered late, or corrected backwards, went on billing the days
 * after the box had gone. A clock whose `ends_on` was set recently is now
 * re-accrued to that date (never past `asOf`), and written only when the
 * figure differs, so a settled clock costs one read a night until it ages out
 * of the window.
 *
 * ## What it will not touch
 *
 * A job that is closed or cancelled is finished: its costs are what they are,
 * and a clock somebody forgot to stop must not keep growing a line on it. And a
 * line that has already been invoiced, exported to the ledger or matched to a
 * carrier's bill is a settled figure other records agree with — re-pricing it
 * underneath them would make the payable and the accrual disagree without
 * anybody having changed either. Both are counted, not silently skipped.
 *
 * ## Foreign-currency clocks are converted, or refused
 *
 * A clock can be in any currency — a carrier's USD per-diem is the usual case
 * — and the line used to be written with `fx_rate` 1 and `amount_base` equal
 * to the foreign amount, so USD 750 of demurrage sat in margin and reports as
 * KWD 750. It is converted at the latest rate on or before the day, as the
 * other cost paths are; with no rate at all the clock is counted as
 * unconvertible and left for the morning, never written at parity.
 */

import { and, eq, gte, isNotNull, isNull, lte, notInArray, or, sql } from 'drizzle-orm'
import {
  accrue,
  convert,
  dec,
  fxRate,
  isPlausibleClockStart,
  toCalendarDate,
  toDb,
  type ClockConfig,
} from '@qabandi/core'
import {
  branches,
  chargeLines,
  chargeTypes,
  freeTimeClocks,
  fxRates,
  jobs,
  supplierInvoiceMatches,
  systemActor,
  withActor,
  type Tx,
} from '@qabandi/db'
import { loadCalendars } from './calendars'

/** Job states after which nothing more is accrued against the job. */
const FINISHED_JOB_STATUSES = ['closed', 'cancelled'] as const

/**
 * How long after a clock was last edited a stopped clock is still re-settled.
 * Long enough to catch a return entered or corrected weeks late.
 */
const SETTLE_WINDOW_DAYS = 35

export interface FreeTimeAccrualResult {
  /** Clocks looked at — running ones, and stopped ones still being settled. */
  readonly clocks: number
  /** Lines written or updated. */
  readonly lines: number
  readonly implausible: number
  /** Foreign-currency clocks with no rate to the branch base — nothing written. */
  readonly unconvertible: number
  /** Clocks whose line is invoiced, exported or matched to a bill — left as settled. */
  readonly frozen: number
}

export async function runFreeTimeAccrual(asOf = new Date()): Promise<FreeTimeAccrualResult> {
  const actor = systemActor()
  let lines = 0
  let implausible = 0
  let unconvertible = 0
  let frozen = 0

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
      .where(
        and(
          notInArray(jobs.status, [...FINISHED_JOB_STATUSES]),
          or(
            isNull(freeTimeClocks.endsOn),
            // Stopped, and touched recently enough that the stop may be news.
            and(
              isNotNull(freeTimeClocks.endsOn),
              gte(
                freeTimeClocks.updatedAt,
                sql`now() - make_interval(days => ${SETTLE_WINDOW_DAYS})`,
              ),
            ),
          ),
        ),
      )

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

      /*
        A start date outside living memory is a typo, not six years of demurrage.

        `accrue` will answer honestly for any date it is given, and this worker
        writes a charge line from the answer with nobody in the loop — so one
        mistyped year became KWD 67,956 on a shipment that had been in the
        country a fortnight, above a green tick reading "charge line written
        automatically". Refusing to bill it is the smaller wrong: the days are
        recoverable from a corrected date, an invoice sent to a customer is not.

        Counted rather than ignored. The result is logged whole, so a clock this
        skips shows up as a number somebody can ask about — a silent `continue`
        here would read as "nothing was accruing", which is what let the wrong
        figure sit on the screen in the first place.
      */
      const today = toCalendarDate(asOf, calendar)
      if (!isPlausibleClockStart(row.clock.startsOn, today)) {
        implausible++
        continue
      }

      /*
        The end the clock is accrued to: the day it was stopped, or today while
        it runs. A stop dated after today has not happened yet, so it runs to
        today — accruing to a future `ends_on` would bill days nobody has
        incurred.
      */
      const stopped = row.clock.endsOn !== null && row.clock.endsOn <= today
      const result = accrue(
        cfg,
        {
          startedOn: new Date(`${row.clock.startsOn}T00:00:00Z`),
          endedOn: stopped ? new Date(`${row.clock.endsOn}T00:00:00Z`) : null,
        },
        calendar,
        asOf,
      )

      // The charge line is keyed to the clock, so a re-run after a crash — or
      // a second run on the same night — updates rather than duplicates.
      const [existing] = await tx
        .select({
          id: chargeLines.id,
          invoiceId: chargeLines.invoiceId,
          accountingExportId: chargeLines.accountingExportId,
        })
        .from(chargeLines)
        .where(
          and(
            eq(chargeLines.sourceKind, 'free_time_clock'),
            eq(chargeLines.sourceId, row.clock.id),
          ),
        )
        .limit(1)

      // Nothing chargeable and nothing written before: nothing to say.
      if (result.chargeableDays === 0 && !existing) continue

      // Settled already at exactly this figure — the usual case for a stopped clock.
      const amount = toDb(result.amount)
      if (
        existing &&
        row.clock.chargeLineId === existing.id &&
        row.clock.accruedDays === result.chargeableDays &&
        row.clock.accruedAmount !== null &&
        dec(row.clock.accruedAmount).eq(result.amount.amount)
      ) {
        continue
      }

      if (existing && (await isSettledLine(tx, existing))) {
        frozen++
        continue
      }

      const conversion = await toBase(tx, row.clock.currency, row.baseCurrency, today)
      if (!conversion) {
        unconvertible++
        console.error(
          {
            clockId: row.clock.id,
            currency: row.clock.currency,
            baseCurrency: row.baseCurrency,
          },
          'free-time accrual: no exchange rate to the branch base, nothing written',
        )
        continue
      }

      const [chargeType] = await tx
        .select({ id: chargeTypes.id })
        .from(chargeTypes)
        .where(eq(chargeTypes.key, row.clock.kind))
        .limit(1)
      if (!chargeType) continue

      const values = {
        jobId: row.clock.jobId,
        branchId: row.branchId,
        direction: 'cost' as const,
        chargeTypeId: chargeType.id,
        description:
          result.chargeableDays === 0
            ? `${row.clock.kind} — no chargeable days`
            : `${row.clock.kind} — ${result.chargeableDays} day(s) from ${result.firstChargeableOn}`,
        basis: 'per_day' as const,
        quantity: String(result.chargeableDays),
        rate: row.clock.perDiem,
        amount,
        currency: row.clock.currency,
        // Same-currency accrual keeps the identity rate, so every line carries
        // an FX rate and a timestamp without a special case (FR-RT-06).
        fxRate: conversion.toFixed(),
        fxRateAt: asOf,
        amountBase: convert(
          result.amount,
          fxRate(row.clock.currency, row.baseCurrency, conversion, asOf),
        )
          .amount.toDecimalPlaces(6)
          .toFixed(),
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
          accruedAmount: amount,
          lastAccruedAt: asOf,
          chargeLineId: line!.id,
        })
        .where(eq(freeTimeClocks.id, row.clock.id))

      lines++
    }

    return { clocks: open.length, lines, implausible, unconvertible, frozen }
  })
}

/**
 * Whether a line is a figure other records already agree with.
 *
 * Invoiced (`invoice_id`), posted to the ledger (`accounting_export_id`), or
 * matched to a carrier's bill by a match nobody retracted.
 */
async function isSettledLine(
  tx: Tx,
  line: { id: string; invoiceId: string | null; accountingExportId: string | null },
): Promise<boolean> {
  if (line.invoiceId || line.accountingExportId) return true
  const [match] = await tx
    .select({ id: supplierInvoiceMatches.id })
    .from(supplierInvoiceMatches)
    .where(
      and(
        eq(supplierInvoiceMatches.chargeLineId, line.id),
        isNull(supplierInvoiceMatches.retractedAt),
      ),
    )
    .limit(1)
  return Boolean(match)
}

/**
 * Units of `base` per one unit of `currency`, struck as a charge line stores it.
 *
 * The latest rate on or before the day, in either direction — feeds publish
 * one way and the reverse is arithmetic, the rule `credit.ts` reads by. Rounded
 * to the eight places `charge_lines.fx_rate` holds before it is used, so the
 * line's own `amount × fx_rate` is its `amount_base`. Null when there is no
 * rate at all, which the caller refuses rather than guessing parity.
 */
async function toBase(
  tx: Tx,
  currency: string,
  base: string,
  on: string,
): Promise<ReturnType<typeof dec> | null> {
  if (currency === base) return dec(1)

  const [direct] = await tx
    .select({ rate: fxRates.rate, effectiveOn: fxRates.effectiveOn })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.fromCurrency, currency),
        eq(fxRates.toCurrency, base),
        lte(fxRates.effectiveOn, on),
      ),
    )
    .orderBy(sql`${fxRates.effectiveOn} desc`)
    .limit(1)
  if (direct) return dec(direct.rate).toDecimalPlaces(8)

  const [inverse] = await tx
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.fromCurrency, base),
        eq(fxRates.toCurrency, currency),
        lte(fxRates.effectiveOn, on),
        sql`${fxRates.rate} > 0`,
      ),
    )
    .orderBy(sql`${fxRates.effectiveOn} desc`)
    .limit(1)
  return inverse ? dec(1).div(dec(inverse.rate)).toDecimalPlaces(8) : null
}
