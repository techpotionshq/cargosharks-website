/**
 * Every branch's working calendar, loaded once per run.
 *
 * Lifted out of `free-time-accrual.ts` when `free-time-warning.ts` needed the
 * same thing. Two copies would be two chances for the warning and the accrual
 * to disagree about whether a Friday counts — and a warning that says four
 * days against a bill that charges from day three is worse than no warning,
 * because it teaches the coordinator to stop trusting it.
 *
 * A map rather than a per-clock lookup: a nightly run touches every open clock
 * in the deployment and there are five calendars.
 */

import { calendarHolidays, workingCalendars } from '@qabandi/db'
import type { WorkingCalendar } from '@qabandi/core'

/**
 * `tx` is the caller's actored transaction, deliberately untyped.
 *
 * Drizzle's transaction type is generic over the whole schema and naming it
 * here would drag the schema type into every worker that loads a calendar.
 */
export async function loadCalendars(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
): Promise<Map<string, WorkingCalendar>> {
  const rows = await tx.select().from(workingCalendars)
  const holidays = await tx.select().from(calendarHolidays)

  const byCalendar = new Map<string, Set<string>>()
  for (const h of holidays as { calendarId: string; onDate: string }[]) {
    const set = byCalendar.get(h.calendarId) ?? new Set<string>()
    set.add(h.onDate)
    byCalendar.set(h.calendarId, set)
  }

  const map = new Map<string, WorkingCalendar>()
  for (const row of rows as {
    id: string
    timeZone: string
    weekend: number[]
    dayStartMinute: number
    dayEndMinute: number
  }[]) {
    map.set(row.id, {
      id: row.id,
      timeZone: row.timeZone,
      weekend: row.weekend as WorkingCalendar['weekend'],
      holidays: byCalendar.get(row.id) ?? new Set(),
      hours: { startMinute: row.dayStartMinute, endMinute: row.dayEndMinute },
    })
  }
  return map
}
