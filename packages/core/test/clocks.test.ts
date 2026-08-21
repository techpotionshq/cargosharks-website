import { describe, expect, it } from 'vitest'
import {
  D,
  KUWAIT_CALENDAR,
  accrue,
  addWorkingDays,
  elapsedWorkingHours,
  freeTimeRemaining,
  isPlausibleClockStart,
  isWorkingDay,
  slaDueAt,
  toCalendarDate,
  workingDaysBetween,
  type WorkingCalendar,
} from '../src/index'

// Kuwait: weekend is Friday and Saturday. 2026-08-14 is a Friday.
const kuwait: WorkingCalendar = {
  ...KUWAIT_CALENDAR,
  holidays: new Set(['2026-08-19']),
}

// The UAE weekend is Saturday and Sunday — the same code, different rows.
const dubai: WorkingCalendar = {
  id: 'dubai',
  timeZone: 'Asia/Dubai',
  weekend: [6, 0],
  holidays: new Set(),
  hours: { startMinute: 9 * 60, endMinute: 18 * 60 },
}

describe('per-branch calendars (NFR-03)', () => {
  it('reads the weekend from the calendar, not from a constant', () => {
    expect(isWorkingDay('2026-08-14', kuwait)).toBe(false) // Friday
    expect(isWorkingDay('2026-08-14', dubai)).toBe(true)
    expect(isWorkingDay('2026-08-16', kuwait)).toBe(true) // Sunday
    expect(isWorkingDay('2026-08-16', dubai)).toBe(false)
  })

  it('skips holidays', () => {
    expect(isWorkingDay('2026-08-19', kuwait)).toBe(false)
    expect(addWorkingDays('2026-08-18', 1, kuwait)).toBe('2026-08-20')
  })

  it('counts working days over a weekend', () => {
    // Thu 13th through Mon 17th, half-open: Thu, Sun = 2.
    expect(workingDaysBetween('2026-08-13', '2026-08-17', kuwait)).toBe(2)
  })
})

describe('SLA ageing (FR-EQ-01)', () => {
  it('does not age an enquiry across the Kuwaiti weekend', () => {
    // Thursday 16:50 local (13:50 UTC) to Sunday 08:00 local.
    const arrived = new Date('2026-08-13T13:50:00Z')
    const sunday = new Date('2026-08-16T05:00:00Z')
    expect(elapsedWorkingHours(arrived, sunday, kuwait)).toBeCloseTo(10 / 60, 5)
  })

  it('places a four-hour SLA started late on Thursday on Sunday morning', () => {
    const arrived = new Date('2026-08-13T13:50:00Z') // Thu 16:50 Kuwait
    const due = slaDueAt(arrived, 4 * 60, kuwait)
    // 10 minutes on Thursday, the remaining 3h50 from Sunday 08:00 -> 11:50.
    expect(toCalendarDate(due, kuwait)).toBe('2026-08-16')
    expect(due.toISOString()).toBe('2026-08-16T08:50:00.000Z')
  })
})

describe('free-time clocks (FR-JB-08, PP-07)', () => {
  const demurrage = {
    kind: 'demurrage' as const,
    freeDays: 5,
    perDiem: new D('35'),
    currency: 'USD',
  }
  const window = { startedOn: new Date('2026-08-01T06:00:00Z'), endedOn: null }

  it('charges nothing inside free time', () => {
    const result = accrue(demurrage, window, kuwait, new Date('2026-08-04T06:00:00Z'))
    expect(result.chargeableDays).toBe(0)
    expect(result.amount.amount.toFixed(2)).toBe('0.00')
    expect(freeTimeRemaining(demurrage, window, kuwait, new Date('2026-08-04T06:00:00Z'))).toBe(1)
  })

  it('charges each day past free time', () => {
    // 1 Aug is day one; free time covers through 5 Aug; as of 9 Aug, 4 days.
    const result = accrue(demurrage, window, kuwait, new Date('2026-08-09T06:00:00Z'))
    expect(result.chargeableDays).toBe(4)
    expect(result.amount.amount.toFixed(2)).toBe('140.00')
    expect(result.firstChargeableOn).toBe('2026-08-06')
    expect(result.stillRunning).toBe(true)
  })

  it('stops at gate-in', () => {
    const closed = { startedOn: window.startedOn, endedOn: new Date('2026-08-07T06:00:00Z') }
    const result = accrue(demurrage, closed, kuwait, new Date('2026-08-20T06:00:00Z'))
    expect(result.chargeableDays).toBe(2)
    expect(result.stillRunning).toBe(false)
  })

  it('escalates across per-diem tiers', () => {
    const tiered = {
      ...demurrage,
      tiers: [
        { fromDay: 1, perDiem: new D('35') },
        { fromDay: 4, perDiem: new D('70') },
      ],
    }
    const result = accrue(tiered, window, kuwait, new Date('2026-08-11T06:00:00Z'))
    // 6 chargeable days: three at 35, three at 70.
    expect(result.chargeableDays).toBe(6)
    expect(result.amount.amount.toFixed(2)).toBe('315.00')
  })

  it('counts storage on working days where the terminal does', () => {
    const storage = {
      kind: 'storage' as const,
      freeDays: 3,
      perDiem: new D('10'),
      currency: 'KWD',
      dayBasis: 'working' as const,
    }
    // Starts Sunday 9 Aug; Fri 14 and Sat 15 do not count.
    const result = accrue(
      storage,
      { startedOn: new Date('2026-08-09T06:00:00Z'), endedOn: null },
      kuwait,
      new Date('2026-08-16T06:00:00Z'),
    )
    expect(result.chargeableDays).toBe(3)
  })
})

describe('clock start plausibility', () => {
  const today = '2026-08-22'

  it('accepts an ordinary discharge a fortnight ago', () => {
    expect(isPlausibleClockStart('2026-08-08', today)).toBe(true)
  })

  it('accepts a container genuinely stuck for a year', () => {
    expect(isPlausibleClockStart('2025-08-22', today)).toBe(true)
  })

  it('refuses the mistyped year that billed 2427 days', () => {
    expect(isPlausibleClockStart('2019-12-26', today)).toBe(false)
  })

  it('allows a clock set up ahead of an expected discharge', () => {
    expect(isPlausibleClockStart('2026-09-15', today)).toBe(true)
  })

  it('refuses a date that is years away rather than weeks', () => {
    expect(isPlausibleClockStart('2029-01-01', today)).toBe(false)
  })

  /*
    The boundary is stated rather than implied: 730 days back is the last
    acceptable day, so a test that only checked "two years ago" would pass
    against an off-by-one in either direction.
  */
  it('is inclusive on both bounds', () => {
    expect(isPlausibleClockStart('2024-08-22', today)).toBe(true)
    expect(isPlausibleClockStart('2024-08-21', today)).toBe(false)
    expect(isPlausibleClockStart('2027-08-22', today)).toBe(true)
    expect(isPlausibleClockStart('2027-08-23', today)).toBe(false)
  })
})
