/**
 * Formatting — money, dates, durations.
 *
 * Two of these have already broken in production and both are pinned below:
 * a `timestamptz` read through `tx.execute` arriving as an ISO string rather
 * than a `Date` (which threw `RangeError` and took down the quotation page),
 * and KWD's three decimal places.
 *
 * The date assertions are written against `Asia/Kuwait` explicitly rather than
 * against the machine's zone, so they mean the same thing on a developer's
 * laptop in Kuwait and on a CI runner in UTC. A formatting test that passes
 * only where it was written is worse than none.
 */

import { describe, expect, it } from 'vitest'
import {
  TIME_ZONE,
  formatDate,
  formatDateTime,
  formatDay,
  formatLane,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  trimDecimal,
} from './format'

describe('formatMoney', () => {
  /**
   * The database's own string, straight through. A `numeric(19,6)` arrives as
   * `"1840.500000"`, and it is formatted at the currency's precision without
   * ever becoming a float — including a value a float cannot hold exactly.
   */
  it('formats a decimal string without converting it to a number', () => {
    expect(formatMoney({ amount: '1840.500000', currency: 'KWD' }, 'en')).toMatch(
      /^KWD\s1,840\.500$/,
    )
    expect(formatMoney({ amount: '9007199254740993.125', currency: 'KWD' }, 'en')).toMatch(
      /^KWD\s9,007,199,254,740,993\.125$/,
    )
  })

  /**
   * The trap the module exists for. KWD carries three decimals — 1.5 KWD is
   * `1.500`, and a quotation printing `1.50` looks wrong to everyone reading
   * it. The minor units come from `Intl`, never from a table here.
   */
  it('gives KWD three decimal places', () => {
    expect(formatMoney({ amount: 1.5, currency: 'KWD' }, 'en')).toContain('1.500')
  })

  it('gives USD two', () => {
    expect(formatMoney({ amount: 1.5, currency: 'USD' }, 'en')).toContain('1.50')
  })

  it('gives JPY none', () => {
    const formatted = formatMoney({ amount: 1500, currency: 'JPY' }, 'en')
    expect(formatted).toContain('1,500')
    expect(formatted).not.toContain('1,500.')
  })

  it('renders an absent amount as an em-dash, not as zero', () => {
    expect(formatMoney(null, 'en')).toBe('—')
    expect(formatMoney(undefined, 'en')).toBe('—')
  })

  it('renders zero as zero, which is not the same as absent', () => {
    expect(formatMoney({ amount: 0, currency: 'KWD' }, 'en')).toContain('0.000')
  })

  it('keeps the sign on a negative amount', () => {
    expect(formatMoney({ amount: -250.5, currency: 'KWD' }, 'en')).toMatch(/[-−]/)
  })

  it('drops the currency when asked', () => {
    const without = formatMoney({ amount: 1234.5, currency: 'KWD' }, 'en', { showCurrency: false })
    expect(without).not.toMatch(/KWD|د\.ك/)
    expect(without).toContain('1,234.5')
  })

  /*
    Without the code the figure still keeps its currency's places. Decimal
    style ignored the currency: a dinar column printed "1,145.69" beside
    "110.495", and a dollar figure printed three places.
  */
  it("keeps the currency's places when the code is dropped", () => {
    const bare = (amount: number, currency: string) =>
      formatMoney({ amount, currency }, 'en', { showCurrency: false })
    expect(bare(1145.69, 'KWD')).toBe('1,145.690')
    expect(bare(1595486.978, 'USD')).toBe('1,595,486.98')
    expect(bare(1500, 'JPY')).toBe('1,500')
  })

  /** Compact only above ten thousand — below it, the exact figure is wanted. */
  it('does not compact below ten thousand', () => {
    expect(formatMoney({ amount: 9999, currency: 'KWD' }, 'en', { compact: true })).toContain(
      '9,999',
    )
  })

  /**
   * Case-insensitive, because the casing is CLDR's to choose and not ours.
   *
   * This assertion has now been wrong twice in opposite directions. It was
   * first written against `25K`, then "fixed" to `25k` on the reasoning that
   * `intlLocale` maps every non-Arabic locale to `en-GB` and British English
   * compacts to a lower-case `k`. That reasoning is wrong for currency: both
   * `en-GB` and `en-US` produce `KWD 25K` under a full-ICU Node.
   *
   * What this test is actually for is that the threshold works — that 25,000
   * comes back compacted where 9,999 does not. Pinning the letter's case makes
   * a CLDR revision look like a regression in our formatting, so match either.
   */
  it('compacts at and above ten thousand', () => {
    expect(formatMoney({ amount: 25_000, currency: 'KWD' }, 'en', { compact: true })).toMatch(
      /25k/i,
    )
  })

  /**
   * Western digits in Arabic too. A container number read against a printed
   * document in Eastern Arabic numerals is how transcription errors happen.
   */
  it('uses Western numerals in Arabic', () => {
    const arabic = formatMoney({ amount: 1234.5, currency: 'KWD' }, 'ar')
    expect(arabic).toMatch(/1/)
    expect(arabic).not.toMatch(/[٠-٩]/)
  })
})

describe('trimDecimal', () => {
  /** `numeric(19,6)` comes back padded; an editable field should not show it. */
  it('strips the scale padding a numeric column arrives with', () => {
    expect(trimDecimal('25000.000000')).toBe('25000')
    expect(trimDecimal('10.500000')).toBe('10.5')
    expect(trimDecimal('1.010000')).toBe('1.01')
  })

  it('leaves a genuine fractional value alone', () => {
    expect(trimDecimal('0.50')).toBe('0.5')
    expect(trimDecimal('100.000001')).toBe('100.000001')
  })

  /**
   * The case the early return exists for. `1200` has trailing zeros and no
   * decimal point; trimming them would turn twelve hundred into twelve.
   */
  it('never touches trailing zeros in a whole number', () => {
    expect(trimDecimal('1200')).toBe('1200')
    expect(trimDecimal('100')).toBe('100')
    expect(trimDecimal('0')).toBe('0')
  })

  it('collapses an all-zero decimal to a single zero', () => {
    expect(trimDecimal('0.000000')).toBe('0')
  })

  it('passes null and empty through as null', () => {
    expect(trimDecimal(null)).toBeNull()
    expect(trimDecimal(undefined)).toBeNull()
    expect(trimDecimal('')).toBeNull()
  })

  it('keeps a negative value negative', () => {
    expect(trimDecimal('-10.500000')).toBe('-10.5')
  })

  /**
   * Documented, not endorsed: a negative zero trims to `-0` rather than `0`.
   * Cosmetic and only reachable from a zero-valued credit, but pinned so a
   * change to the guard is deliberate.
   */
  it('leaves negative zero as -0', () => {
    expect(trimDecimal('-0.000000')).toBe('-0')
  })
})

describe('date coercion', () => {
  /**
   * The production bug. The same column read through the query builder is a
   * `Date` and through `tx.execute` is an ISO string; `Intl` throws
   * `RangeError: Invalid time value` on the string. TypeScript could not see
   * it because the raw row is a cast.
   */
  it('accepts an ISO string as well as a Date', () => {
    const asDate = new Date('2026-08-18T09:15:00Z')
    expect(formatDate('2026-08-18T09:15:00Z', 'en')).toBe(formatDate(asDate, 'en'))
    expect(formatDateTime('2026-08-18T09:15:00Z', 'en')).toBe(formatDateTime(asDate, 'en'))
    expect(formatTime('2026-08-18T09:15:00Z', 'en')).toBe(formatTime(asDate, 'en'))
    expect(formatDay('2026-08-18T09:15:00Z', 'en')).toBe(formatDay(asDate, 'en'))
  })

  it('accepts an epoch number', () => {
    const ms = Date.UTC(2026, 7, 18, 9, 15)
    expect(formatDate(ms, 'en')).toBe(formatDate(new Date(ms), 'en'))
  })

  /** A dash reads as "not recorded". "Invalid Date" reads as a broken product. */
  it.each([null, undefined, '', 'not a date', new Date('nonsense')])(
    'renders %s as an em-dash rather than throwing',
    (value) => {
      expect(formatDate(value as Date | string | null, 'en')).toBe('—')
      expect(formatDateTime(value as Date | string | null, 'en')).toBe('—')
      expect(formatTime(value as Date | string | null, 'en')).toBe('—')
      expect(formatDay(value as Date | string | null, 'en')).toBe('—')
      expect(formatRelative(value as Date | string | null, 'en')).toBe('—')
    },
  )
})

describe('the branch time zone', () => {
  it('is Kuwait', () => {
    expect(TIME_ZONE).toBe('Asia/Kuwait')
  })

  /**
   * The reason every formatter pins a zone. 22:00 UTC on the 18th is 01:00 on
   * the *19th* in Kuwait — a vessel arrival recorded late in the evening reads
   * as the wrong day on a UTC server, and the day is what an operator plans
   * against.
   */
  it('formats a late-evening UTC instant as the next Kuwait day', () => {
    expect(formatDate('2026-08-18T22:00:00Z', 'en')).toBe('19 Aug 2026')
    expect(formatTime('2026-08-18T22:00:00Z', 'en')).toBe('01:00')
  })

  /** And the converse: 23:40 in Kuwait stays on its own day. */
  it('keeps a 23:40 Kuwait arrival on the same day', () => {
    expect(formatDate('2026-08-18T20:40:00Z', 'en')).toBe('18 Aug 2026')
    expect(formatTime('2026-08-18T20:40:00Z', 'en')).toBe('23:40')
  })

  /** Kuwait does not observe daylight saving; the offset is +03 year-round. */
  it('uses the same offset in January and July', () => {
    expect(formatTime('2026-01-15T12:00:00Z', 'en')).toBe('15:00')
    expect(formatTime('2026-07-15T12:00:00Z', 'en')).toBe('15:00')
  })

  /** 24-hour in both languages: "7:00" without an am/pm has missed sailings. */
  it('is always 24-hour', () => {
    expect(formatTime('2026-08-18T16:00:00Z', 'en')).toBe('19:00')
    expect(formatTime('2026-08-18T16:00:00Z', 'ar')).toContain('19:00')
  })
})

describe('formatRelative', () => {
  const now = Date.UTC(2026, 7, 18, 12, 0, 0)
  const at = (ms: number) => new Date(now + ms)

  it('counts in minutes below the hour', () => {
    expect(formatRelative(at(30 * 60_000), 'en', now)).toContain('30 minutes')
    expect(formatRelative(at(-30 * 60_000), 'en', now)).toContain('30 minutes ago')
  })

  it('switches to hours at sixty minutes', () => {
    expect(formatRelative(at(59 * 60_000), 'en', now)).toContain('minute')
    expect(formatRelative(at(60 * 60_000), 'en', now)).toContain('hour')
  })

  it('switches to days at forty-eight hours', () => {
    expect(formatRelative(at(47 * 3_600_000), 'en', now)).toContain('hour')
    expect(formatRelative(at(48 * 3_600_000), 'en', now)).toContain('day')
  })

  /** `numeric: 'auto'` is what turns zero into words rather than "in 0 minutes". */
  it('words the present rather than counting zero', () => {
    expect(formatRelative(at(0), 'en', now)).toBe('this minute')
  })

  /**
   * A consequence of the 48-hour cutoff worth stating: "yesterday" never
   * appears. Twenty-four hours ago reads as "24 hours ago", because the SLA
   * column wants elapsed time rather than a calendar word — "yesterday" covers
   * anything from two hours to forty-seven and answers the wrong question.
   */
  it('speaks in hours across a day boundary, not in calendar words', () => {
    expect(formatRelative(at(-86_400_000), 'en', now)).toBe('24 hours ago')
    expect(formatRelative(at(86_400_000), 'en', now)).toBe('in 24 hours')
  })

  it('distinguishes past from future', () => {
    expect(formatRelative(at(3 * 86_400_000), 'en', now)).toContain('in 3 days')
    expect(formatRelative(at(-3 * 86_400_000), 'en', now)).toContain('3 days ago')
  })
})

describe('formatPercent and formatNumber', () => {
  /** The input is a percentage already — 15 means 15%, not 1500%. */
  it('treats the input as a percentage, not a fraction', () => {
    expect(formatPercent(15, 'en')).toBe('15.0%')
    expect(formatPercent(0, 'en')).toBe('0.0%')
  })

  it('keeps one decimal, which is the precision a margin is discussed at', () => {
    expect(formatPercent(15.25, 'en')).toBe('15.3%')
    expect(formatPercent(-4.5, 'en')).toContain('4.5%')
  })

  it('renders an absent percentage as an em-dash', () => {
    expect(formatPercent(null, 'en')).toBe('—')
    expect(formatPercent(undefined, 'en')).toBe('—')
  })

  it('groups thousands', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567')
  })

  it('uses Western numerals in Arabic', () => {
    expect(formatNumber(1234, 'ar')).not.toMatch(/[٠-٩]/)
  })
})

describe('formatLane', () => {
  /** U+2192, not "->": the arrow flips with the surrounding text direction. */
  it('joins with a real arrow', () => {
    expect(formatLane('Shuwaikh', 'Jebel Ali')).toBe('Shuwaikh → Jebel Ali')
    expect(formatLane('Shuwaikh', 'Jebel Ali')).not.toContain('->')
    // Arabic reorders the names, so the arrow has to point the other way.
    expect(formatLane('الشويخ', 'جبل علي', 'ar')).toBe('الشويخ ← جبل علي')
  })
})
