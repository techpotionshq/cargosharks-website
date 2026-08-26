/**
 * Time zones — whose day is it.
 *
 * `lib/format.ts` has always rendered *instants* in a fixed zone, and that half
 * was right: a vessel that berthed at 23:40 in Kuwait must not read as the next
 * day because the server runs in UTC. What was missing is the other half — the
 * arithmetic. Roughly twenty call sites computed "today" as
 * `new Date().toISOString().slice(0, 10)`, which is the *UTC* date, and Kuwait
 * is UTC+3 with no daylight saving. For the first three hours of every local day
 * the server therefore believed it was still yesterday.
 *
 * That is not cosmetic. It chose the rate card a quote was priced against
 * (`features/ledger/pricing.ts`), decided whether a credit hold had expired
 * (`features/credit/queries.ts`), and set the horizon for demurrage free time
 * (`service/src/ai/tools.ts`) — a charge levied per day. One slice had already
 * diagnosed it and written the fix privately, with a comment that turned out to
 * be a prediction: *"a date helper that is quietly wrong for three hours a day
 * is the kind that gets reused somewhere it does matter."*
 *
 * ## Two zones, and which is which
 *
 * A person's zone is a **display** preference. A Kuwaiti forwarder has a Dubai
 * branch, agents in Shanghai and Rotterdam, and a portal opened from anywhere;
 * hard-coding one zone makes everyone outside it read every timestamp with an
 * offset in their head, and the person most likely to misread a cut-off is the
 * one furthest from the head office. That is what this file's picker sets, and
 * what `formatDate` and friends now take.
 *
 * A **business** date is the branch's, and deliberately not the reader's. Which
 * rate card is live, whether a credit hold has lapsed, when free time runs out —
 * those must not move with who is looking, or two colleagues price the same
 * quote differently. Those callers pass no zone and get `DEFAULT_TIME_ZONE`.
 *
 * Conflating the two would trade a three-hour bug for a permanent one.
 */

/*
  The rules themselves live in `core/time.ts`, because the service asks the
  same question of free-time clocks and one copy of a subtlety this sharp is
  the point. What stays here is what only a browser session needs: the cookie
  the request config reads, and the menu a person picks from.
*/
export { DEFAULT_TIME_ZONE, dayIn, isTimeZone, resolveTimeZone, todayIn } from '@qabandi/core'

/** The cookie mirrors `LOCALE_COOKIE` — resolution must not need a query. */
export const TIME_ZONE_COOKIE = 'qabandi_tz'

/**
 * The zones offered in the picker.
 *
 * The trade lanes this product actually carries — the Gulf, the sub-continent,
 * the Far East origins in the seed data, the North European destinations — plus
 * UTC for anyone reconciling against a carrier's own timestamps.
 *
 * Not a closed set: `isTimeZone` accepts any zone the platform knows, so a
 * stored preference from a future list still resolves. This is the menu, not
 * the vocabulary.
 */
export const TIME_ZONES: readonly string[] = [
  'Asia/Kuwait',
  'Asia/Riyadh',
  'Asia/Bahrain',
  'Asia/Qatar',
  'Asia/Baghdad',
  'Asia/Dubai',
  'Asia/Muscat',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Europe/Istanbul',
  'Europe/Amsterdam',
  'Europe/London',
  'America/New_York',
  'UTC',
]

/**
 * How a zone is offered in the picker: `Asia/Dubai` → `Dubai (GMT+4)`.
 *
 * The offset is resolved for *now* rather than stated, so a zone that observes
 * daylight saving reads correctly in both halves of the year — London is GMT+1
 * in July and the label says so.
 */
export function describeTimeZone(timeZone: string, locale: string = 'en'): string {
  const city = timeZone === 'UTC' ? 'UTC' : (timeZone.split('/').pop() ?? timeZone)
  const label = city.replace(/_/g, ' ')

  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value
    return offset ? `${label} (${offset})` : label
  } catch {
    return label
  }
}
