import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIME_ZONE,
  dayIn,
  instantFromLocal,
  isTimeZone,
  localInputValue,
  resolveTimeZone,
  shiftDay,
  todayIn,
} from '../src/index'

/**
 * The three-hour window.
 *
 * Every one of these would have passed against `toISOString().slice(0, 10)` at
 * most times of day, which is exactly why the bug survived: a test written at
 * noon proves nothing about a rule that is wrong between midnight and three.
 * The instants here are chosen to sit inside the gap.
 */
describe('dayIn', () => {
  it('gives Kuwait its own day when UTC is still on the one before', () => {
    // 22:00 UTC on the 26th is 01:00 on the 27th in Kuwait.
    const instant = new Date('2026-08-26T22:00:00Z')

    expect(dayIn(instant, 'Asia/Kuwait')).toBe('2026-08-27')
    // The shape the codebase used to use, kept here as the counter-example.
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-26')
  })

  it('keeps a late Kuwait evening on its own day', () => {
    // 20:40 UTC is 23:40 in Kuwait — the berthing the formatter comment warns
    // about, which must not roll forward.
    expect(dayIn(new Date('2026-08-26T20:40:00Z'), 'Asia/Kuwait')).toBe('2026-08-26')
  })

  it('reads the same instant as a different day either side of a zone', () => {
    const instant = new Date('2026-08-26T21:30:00Z')

    expect(dayIn(instant, 'UTC')).toBe('2026-08-26')
    expect(dayIn(instant, 'Asia/Kuwait')).toBe('2026-08-27')
    expect(dayIn(instant, 'America/New_York')).toBe('2026-08-26')
  })

  it('follows daylight saving rather than a fixed offset', () => {
    // London is GMT+1 in July, so 23:30 UTC is already the next day there.
    expect(dayIn(new Date('2026-07-14T23:30:00Z'), 'Europe/London')).toBe('2026-07-15')
    // ...and GMT in January, where the same clock time is not.
    expect(dayIn(new Date('2026-01-14T23:30:00Z'), 'Europe/London')).toBe('2026-01-14')
  })

  it('defaults to the branch zone', () => {
    const instant = new Date('2026-08-26T22:00:00Z')
    expect(dayIn(instant)).toBe(dayIn(instant, DEFAULT_TIME_ZONE))
  })

  it('pads to a sortable YYYY-MM-DD, which is what the date columns compare', () => {
    expect(dayIn(new Date('2026-01-05T09:00:00Z'), 'Asia/Kuwait')).toBe('2026-01-05')
  })
})

describe('todayIn', () => {
  it('takes the instant it is given, so the rule is testable at all', () => {
    expect(todayIn('Asia/Kuwait', new Date('2026-08-26T22:00:00Z'))).toBe('2026-08-27')
    expect(todayIn('UTC', new Date('2026-08-26T22:00:00Z'))).toBe('2026-08-26')
  })
})

describe('isTimeZone', () => {
  it('accepts what the platform knows', () => {
    for (const zone of ['Asia/Kuwait', 'Asia/Dubai', 'Europe/London', 'UTC']) {
      expect(isTimeZone(zone)).toBe(true)
    }
  })

  it('refuses what it does not, rather than throwing later', () => {
    expect(isTimeZone('Nowhere/Bogus')).toBe(false)
    expect(isTimeZone('')).toBe(false)
    expect(isTimeZone(null)).toBe(false)
    expect(isTimeZone(undefined)).toBe(false)
  })
})

describe('resolveTimeZone', () => {
  it('keeps a zone it recognises', () => {
    expect(resolveTimeZone('Asia/Dubai')).toBe('Asia/Dubai')
  })

  it('falls back rather than propagating a stored value tzdata has dropped', () => {
    expect(resolveTimeZone('Nowhere/Bogus')).toBe(DEFAULT_TIME_ZONE)
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIME_ZONE)
  })
})

describe('instantFromLocal', () => {
  it('reads a typed time in the branch zone, not the server zone', () => {
    // 09:00 in Kuwait is 06:00 UTC; `new Date()` on a UTC server said 09:00Z.
    expect(instantFromLocal('2026-10-04T09:00', 'Asia/Kuwait')?.toISOString()).toBe(
      '2026-10-04T06:00:00.000Z',
    )
    expect(instantFromLocal('2026-10-04T09:00', 'Asia/Dubai')?.toISOString()).toBe(
      '2026-10-04T05:00:00.000Z',
    )
  })

  it('keeps a late-evening ETA on its own day', () => {
    const eta = instantFromLocal('2026-10-04T22:00', 'Asia/Kuwait')!
    expect(dayIn(eta, 'Asia/Kuwait')).toBe('2026-10-04')
  })

  it('follows daylight saving', () => {
    expect(instantFromLocal('2026-07-14T09:00', 'Europe/London')?.toISOString()).toBe(
      '2026-07-14T08:00:00.000Z',
    )
    expect(instantFromLocal('2026-01-14T09:00', 'Europe/London')?.toISOString()).toBe(
      '2026-01-14T09:00:00.000Z',
    )
  })

  it('refuses what is not a wall-clock time', () => {
    expect(instantFromLocal('2026-02-31T09:00', 'Asia/Kuwait')).toBeNull()
    expect(instantFromLocal('tomorrow', 'Asia/Kuwait')).toBeNull()
    expect(instantFromLocal('2026-10-04T09:00Z', 'Asia/Kuwait')).toBeNull()
  })

  it('round-trips with localInputValue', () => {
    const instant = new Date('2026-10-04T19:30:00Z')
    const shown = localInputValue(instant, 'Asia/Kuwait')
    expect(shown).toBe('2026-10-04T22:30')
    expect(instantFromLocal(shown!, 'Asia/Kuwait')?.getTime()).toBe(instant.getTime())
    expect(localInputValue(null)).toBeNull()
  })
})

describe('shiftDay', () => {
  it('moves across a month end', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30')
  })
})
