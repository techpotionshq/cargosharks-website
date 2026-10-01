/**
 * Which day is it — the calendar half of time.
 *
 * `Date` is an instant. Almost every business rule in this product is about a
 * *day*: the card a rate is valid on, the day a credit hold lapses, the day
 * free time runs out and demurrage starts. Turning one into the other needs a
 * zone, and the wrong answer is available for free:
 *
 *     new Date().toISOString().slice(0, 10)
 *
 * That is the **UTC** day. Kuwait is UTC+3 with no daylight saving, so for the
 * first three hours of every local day it names yesterday. Roughly twenty call
 * sites had it, and the ones that mattered chose a rate card, expired a credit
 * hold, and set a demurrage horizon — a charge levied per day, decided by a
 * function that was wrong for an eighth of every day.
 *
 * ## Whose day
 *
 * The branch's, not the reader's. A person's time zone is a display preference:
 * it decides whether a berthing reads 23:40 Tuesday or 20:40 Tuesday, and two
 * colleagues may reasonably disagree. A *business* date must not move with who
 * is looking — a Dubai operator and a Kuwait operator pricing the same quote
 * have to get the same card, or the rate depends on the reader.
 *
 * So these take a zone and callers pass the deployment's, while `formatDate`
 * and friends take the reader's. Two questions, two answers, and the bug was
 * having neither.
 *
 * Here rather than in `apps/web` because the service asks it too — free-time
 * clocks and the demurrage horizon — and one copy of a rule this subtle is the
 * whole point. `core` imports nothing; `Intl` is the language, not a
 * dependency.
 */

/** Where the business is, and what everything falls back to. */
export const DEFAULT_TIME_ZONE = 'Asia/Kuwait'

/*
  `en-CA` because its short date format *is* ISO 8601 — `2026-08-26`.

  Reassembling `YYYY-MM-DD` from `formatToParts` is the usual approach and it is
  three chances to get the order or the padding wrong. Asking for a locale that
  already prints it is none.
*/
function isoFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', { timeZone })
}

/** The day `value` falls on in `timeZone`, as `YYYY-MM-DD`. */
export function dayIn(value: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return isoFormatter(timeZone).format(value)
}

/** Today in `timeZone`, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  return dayIn(now, timeZone)
}

/**
 * Whether the platform knows this zone.
 *
 * Asked of `Intl`, which throws `RangeError` on a zone it cannot resolve, so
 * the runtime's own tzdata is the authority rather than a list here that goes
 * stale the next time a country moves its clocks.
 */
export function isTimeZone(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    isoFormatter(value)
    return true
  } catch {
    return false
  }
}

/** A stored zone if the platform knows it, otherwise the default. */
export function resolveTimeZone(value: string | null | undefined): string {
  return isTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

/*
  The other direction — a wall-clock time typed into a form, back to an instant.

  A `datetime-local` input submits `2026-10-04T09:00` with no zone, and
  `new Date()` on a server that runs in UTC reads it as 09:00 UTC. A milestone
  an operator in Kuwait ticked at nine in the morning then displayed as noon,
  and an ETA of 22:00 went out to the customer as the following day. The time
  a person types belongs to the branch they are working for, so it is read in
  that branch's zone — the same rule `dayIn` applies to business dates.
*/

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/** Whether `value` has the `YYYY-MM-DDTHH:mm[:ss]` shape a `datetime-local` posts. */
export function isLocalDateTime(value: string): boolean {
  const match = LOCAL_DATE_TIME.exec(value)
  if (!match) return false
  const [, y, mo, d, h, mi, s] = match
  const probe = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +(s ?? 0)))
  // `Date.UTC` rolls 2026-02-31 over into March; a round trip catches it.
  return (
    probe.getUTCFullYear() === +y! &&
    probe.getUTCMonth() === +mo! - 1 &&
    probe.getUTCDate() === +d! &&
    probe.getUTCHours() === +h! &&
    probe.getUTCMinutes() === +mi!
  )
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return wall - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * The instant a wall-clock time names in `timeZone`, or null if `value` is not
 * one.
 *
 * Two passes rather than one, because the offset that applies is the offset
 * *at the answer*, not at the guess — they differ only across a daylight-saving
 * change, which the Gulf does not keep and half our counterparties do.
 */
export function instantFromLocal(value: string, timeZone: string = DEFAULT_TIME_ZONE): Date | null {
  if (!isLocalDateTime(value)) return null
  const [, y, mo, d, h, mi, s] = LOCAL_DATE_TIME.exec(value)!
  const wall = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +(s ?? 0))
  const zone = resolveTimeZone(timeZone)
  let guess = wall - offsetAt(new Date(wall), zone)
  guess = wall - offsetAt(new Date(guess), zone)
  return new Date(guess)
}

/**
 * The value a `datetime-local` input needs to show `instant` in `timeZone`:
 * `YYYY-MM-DDTHH:mm`. The inverse of `instantFromLocal`, so an edit form that
 * is opened and saved untouched writes back the instant it read.
 */
export function localInputValue(
  instant: Date | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): string | null {
  if (!instant || Number.isNaN(instant.getTime())) return null
  const shifted = new Date(instant.getTime() + offsetAt(instant, resolveTimeZone(timeZone)))
  return shifted.toISOString().slice(0, 16)
}

/** `day` (`YYYY-MM-DD`) moved by `days` calendar days — pure date arithmetic. */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
