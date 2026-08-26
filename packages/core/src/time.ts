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
