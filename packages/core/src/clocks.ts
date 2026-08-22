/**
 * Free-time accrual, SLA ageing, working calendars — Architecture §7.2, §11.
 *
 * One duration function serves enquiry SLA, customs SLA and exception ageing
 * (NFR-03); one accrual function serves demurrage, detention and storage,
 * which differ only in what starts them, who they are owed to, and what they
 * cost per day.
 *
 * Calendars are per branch because Kuwait, Qatar and the UAE share neither a
 * weekend nor a holiday list. Every timestamp entering here is UTC; every
 * calendar decision is made in the branch's own time zone.
 */

import { D, dec, type CurrencyCode, type Money, type Numeric, money, zero } from './money'
import { InvalidCalendarError } from './errors'
import type { Decimal } from 'decimal.js'

/** `YYYY-MM-DD` in the calendar's time zone. Not an instant. */
export type CalendarDate = string

/** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface WorkingHours {
  /** Minutes from local midnight. 08:00 is 480. */
  readonly startMinute: number
  readonly endMinute: number
}

/**
 * Mirrors a `working_calendars` row plus its holiday rows.
 *
 * Kuwait's weekend is Friday and Saturday; the UAE moved to Saturday and half
 * of Friday in 2022. Both are expressible; neither is hard-coded.
 */
export interface WorkingCalendar {
  readonly id: string
  /** IANA zone — `Asia/Kuwait`, `Asia/Dubai`, `Asia/Qatar`. */
  readonly timeZone: string
  readonly weekend: readonly Weekday[]
  /** `YYYY-MM-DD` values. Public holidays for the branch's country. */
  readonly holidays: ReadonlySet<CalendarDate>
  /** Used by hour-based SLAs. Day-based rules ignore it. */
  readonly hours: WorkingHours
}

export const KUWAIT_CALENDAR: WorkingCalendar = {
  id: 'kuwait',
  timeZone: 'Asia/Kuwait',
  weekend: [5, 6],
  holidays: new Set<CalendarDate>(),
  hours: { startMinute: 8 * 60, endMinute: 17 * 60 },
}

// --- calendar dates --------------------------------------------------------

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = dateFormatters.get(timeZone)
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    } catch {
      throw new InvalidCalendarError(`Unknown time zone: ${timeZone}`)
    }
    dateFormatters.set(timeZone, fmt)
  }
  return fmt
}

interface LocalMoment {
  readonly date: CalendarDate
  /** Minutes since local midnight. */
  readonly minute: number
}

/** Projects a UTC instant into the calendar's local date and minute-of-day. */
export function localMoment(at: Date, cal: WorkingCalendar): LocalMoment {
  const parts = formatterFor(cal.timeZone).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '00'
  const hour = Number(get('hour')) % 24
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: hour * 60 + Number(get('minute')),
  }
}

export function toCalendarDate(at: Date, cal: WorkingCalendar): CalendarDate {
  return localMoment(at, cal).date
}

/** Noon UTC, so day arithmetic never lands on a DST discontinuity. */
function anchor(date: CalendarDate): Date {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) throw new InvalidCalendarError(`Not a calendar date: ${date}`)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = anchor(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((anchor(to).getTime() - anchor(from).getTime()) / 86_400_000)
}

export function weekdayOf(date: CalendarDate): Weekday {
  return anchor(date).getUTCDay() as Weekday
}

export function isWorkingDay(date: CalendarDate, cal: WorkingCalendar): boolean {
  return !cal.weekend.includes(weekdayOf(date)) && !cal.holidays.has(date)
}

/** Counts working days in `[from, to)` — the half-open convention throughout. */
export function workingDaysBetween(
  from: CalendarDate,
  to: CalendarDate,
  cal: WorkingCalendar,
): number {
  if (calendarDaysBetween(from, to) <= 0) return 0
  let count = 0
  for (let d = from; d < to; d = addCalendarDays(d, 1)) {
    if (isWorkingDay(d, cal)) count++
  }
  return count
}

export function addWorkingDays(
  date: CalendarDate,
  days: number,
  cal: WorkingCalendar,
): CalendarDate {
  let remaining = Math.abs(days)
  const step = days < 0 ? -1 : 1
  let cursor = date
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, step)
    if (isWorkingDay(cursor, cal)) remaining--
  }
  return cursor
}

/** The next working day at or after `date`. */
export function nextWorkingDay(date: CalendarDate, cal: WorkingCalendar): CalendarDate {
  let cursor = date
  while (!isWorkingDay(cursor, cal)) cursor = addCalendarDays(cursor, 1)
  return cursor
}

// --- SLA ageing ------------------------------------------------------------

/**
 * Working minutes elapsed between two instants.
 *
 * An enquiry that arrives at 16:50 on a Thursday in Kuwait has not breached a
 * four-hour SLA by Sunday morning — it has aged seventy minutes. This is the
 * one function that knows that, and NFR-03's three ageing rules all call it.
 */
export function elapsedWorkingMinutes(from: Date, to: Date, cal: WorkingCalendar): number {
  if (to.getTime() <= from.getTime()) return 0
  const start = localMoment(from, cal)
  const end = localMoment(to, cal)
  const { startMinute, endMinute } = cal.hours

  const clamp = (minute: number): number => Math.min(Math.max(minute, startMinute), endMinute)

  let total = 0
  for (let d = start.date; d <= end.date; d = addCalendarDays(d, 1)) {
    if (!isWorkingDay(d, cal)) continue
    const dayStart = d === start.date ? clamp(start.minute) : startMinute
    const dayEnd = d === end.date ? clamp(end.minute) : endMinute
    total += Math.max(0, dayEnd - dayStart)
  }
  return total
}

export function elapsedWorkingHours(from: Date, to: Date, cal: WorkingCalendar): number {
  return elapsedWorkingMinutes(from, to, cal) / 60
}

/**
 * The instant an SLA of `minutes` working minutes, started at `from`, falls due.
 * Returned as UTC, because that is how it is stored and compared.
 */
export function slaDueAt(from: Date, minutes: number, cal: WorkingCalendar): Date {
  const start = localMoment(from, cal)
  let remaining = minutes
  let date = start.date
  let minute = Math.min(Math.max(start.minute, cal.hours.startMinute), cal.hours.endMinute)

  if (!isWorkingDay(date, cal)) {
    date = nextWorkingDay(date, cal)
    minute = cal.hours.startMinute
  }

  // Walk forward a working day at a time until the budget is exhausted.
  for (let guard = 0; guard < 3650; guard++) {
    const available = cal.hours.endMinute - minute
    if (remaining <= available) {
      return localToUtc(date, minute + remaining, cal)
    }
    remaining -= available
    date = nextWorkingDay(addCalendarDays(date, 1), cal)
    minute = cal.hours.startMinute
  }
  throw new InvalidCalendarError('SLA due date did not converge within ten years')
}

/**
 * Local wall-clock back to a UTC instant.
 *
 * Derived by measuring the zone's offset at the target date rather than
 * assuming one, so a branch in a zone that observes DST stays correct.
 */
function localToUtc(date: CalendarDate, minuteOfDay: number, cal: WorkingCalendar): Date {
  const [y, m, d] = date.split('-').map(Number)
  const naive = Date.UTC(y!, m! - 1, d!, Math.floor(minuteOfDay / 60), minuteOfDay % 60)
  const probe = new Date(naive)
  const seen = localMoment(probe, cal)
  const driftDays = calendarDaysBetween(seen.date, date)
  const driftMinutes = driftDays * 1440 + (minuteOfDay - seen.minute)
  return new Date(naive + driftMinutes * 60_000)
}

// --- free-time clocks ------------------------------------------------------

/**
 * Demurrage: container held inside the terminal beyond free time, owed to the
 * carrier. Detention: container held outside the terminal beyond free time,
 * also the carrier's. Storage: cargo held by the terminal, owed to the port.
 *
 * Three names, one clock.
 */
export type ClockKind = 'demurrage' | 'detention' | 'storage'

/**
 * A per-diem band. Lines almost always escalate — five days at one rate, then
 * a higher one. `fromDay` is the first chargeable day the band applies to,
 * counted after free time expires.
 */
export interface PerDiemTier {
  readonly fromDay: number
  readonly perDiem: Decimal
}

export interface ClockConfig {
  readonly kind: ClockKind
  readonly freeDays: number
  readonly perDiem: Decimal
  readonly currency: CurrencyCode
  /**
   * Whether free time and chargeable days count weekends and holidays.
   * Carrier demurrage is calendar; port storage is often working days.
   */
  readonly dayBasis?: 'calendar' | 'working'
  /** Optional escalation. When present it supersedes `perDiem`. */
  readonly tiers?: readonly PerDiemTier[]
}

export interface ClockWindow {
  /** Gate-out, discharge or arrival — whichever event starts this kind. */
  readonly startedOn: Date
  /** Gate-in or release. Null while the clock is still running. */
  readonly endedOn: Date | null
}

export interface Accrual {
  readonly chargeableDays: number
  readonly amount: Money
  readonly freeDaysUsed: number
  readonly firstChargeableOn: CalendarDate | null
  readonly throughOn: CalendarDate
  readonly stillRunning: boolean
}

/**
 * Days accrued and money owed, as of a given instant.
 *
 * Run nightly per open clock (§9). Where `chargeableDays > 0` the caller writes
 * a `charge_line` — SRS §4.2's "every cost-bearing event writes a line",
 * implemented as a scheduled pure function rather than an operator's memory.
 */
export function accrue(
  cfg: ClockConfig,
  window: ClockWindow,
  calendar: WorkingCalendar,
  asOf: Date,
): Accrual {
  const basis = cfg.dayBasis ?? 'calendar'
  const startDate = toCalendarDate(window.startedOn, calendar)
  const endInstant = window.endedOn ?? asOf
  const endDate = toCalendarDate(endInstant, calendar)

  const countDays = (from: CalendarDate, to: CalendarDate): number =>
    basis === 'working' ? workingDaysBetween(from, to, calendar) : calendarDaysBetween(from, to)

  // The start day is day one; the clock runs through the end day inclusive.
  const throughOn = endDate
  const elapsed = Math.max(0, countDays(startDate, addCalendarDays(throughOn, 1)))
  const freeDaysUsed = Math.min(elapsed, cfg.freeDays)
  const chargeableDays = Math.max(0, elapsed - cfg.freeDays)

  const firstChargeableOn =
    chargeableDays > 0
      ? basis === 'working'
        ? addWorkingDays(startDate, cfg.freeDays, calendar)
        : addCalendarDays(startDate, cfg.freeDays)
      : null

  return {
    chargeableDays,
    amount: chargeableDays === 0 ? zero(cfg.currency) : chargeFor(chargeableDays, cfg),
    freeDaysUsed,
    firstChargeableOn,
    throughOn,
    stillRunning: window.endedOn === null,
  }
}

/**
 * The window a free-time clock's start date may sit in — the guard that keeps
 * a typo from becoming an invoice.
 *
 * `accrue` is pure and correct: give it a start date and it will tell you what
 * has accrued since, however long ago that was. That is the right behaviour for
 * a function and the wrong behaviour for a system, because the nightly worker
 * writes a charge line from the answer without anybody reading it first. A
 * demurrage clock mistyped `2019-12-26` instead of `2026-…` accrued 2427 days
 * at KWD 28 and put KWD 67,956 on a shipment that had been in the country a
 * fortnight — and the screen said "charge line written automatically", which
 * was true and was the problem.
 *
 * Two years back, because a container genuinely stuck in a customs dispute is
 * a real thing and a plausible one; six years is not. One year forward, because
 * starting a clock ahead of an expected discharge is ordinary planning and
 * accrues nothing until the day arrives.
 *
 * A bound rather than a clamp: silently moving somebody's date would bill a day
 * they did not choose, and the honest failure is to refuse the date and say so.
 */
export const MAX_CLOCK_BACKDATE_DAYS = 730
export const MAX_CLOCK_FUTURE_DAYS = 365

export function isPlausibleClockStart(startsOn: CalendarDate, today: CalendarDate): boolean {
  const offset = calendarDaysBetween(today, startsOn)
  return offset >= -MAX_CLOCK_BACKDATE_DAYS && offset <= MAX_CLOCK_FUTURE_DAYS
}

/** Sums the per-diem across escalation bands. */
function chargeFor(chargeableDays: number, cfg: ClockConfig): Money {
  if (!cfg.tiers || cfg.tiers.length === 0) {
    return money(cfg.perDiem.times(chargeableDays), cfg.currency)
  }

  const tiers = [...cfg.tiers].sort((a, b) => a.fromDay - b.fromDay)
  let total = new D(0)
  for (let day = 1; day <= chargeableDays; day++) {
    const tier = [...tiers].reverse().find((t) => t.fromDay <= day)
    total = total.plus(tier ? tier.perDiem : cfg.perDiem)
  }
  return money(total, cfg.currency)
}

/**
 * Days remaining before a clock starts charging — drives the "expiring soon"
 * warnings on the operations board.
 */
export function freeTimeRemaining(
  cfg: ClockConfig,
  window: ClockWindow,
  calendar: WorkingCalendar,
  asOf: Date,
): number {
  const { freeDaysUsed } = accrue(cfg, window, calendar, asOf)
  return Math.max(0, cfg.freeDays - freeDaysUsed)
}

export function perDiem(value: Numeric): Decimal {
  return dec(value)
}

/**
 * How much notice a free-time clock gives before it starts charging.
 *
 * Three days, and the number is here rather than in the worker because the
 * operations board wants the same threshold for its badge. Long enough that a
 * haulier can be booked over a Kuwaiti weekend; short enough that the warning
 * still means something when it arrives.
 *
 * Not a configuration row (FR-AD-03), deliberately. Charge types and calendars
 * are rows because they change what the system *charges*; this changes only
 * when it speaks, and a per-branch notice period is a setting nobody would
 * ever have a reason to differ on.
 */
export const FREE_TIME_WARNING_DAYS = 3

/**
 * The date free time runs out — the last day the container can move for free.
 *
 * `accrue` answers "what has this cost so far", which is the wrong question
 * before anything has. This answers the other one, and it answers it in the
 * clock's own day basis: a port storage clock counting working days expires
 * later than a carrier demurrage clock started the same morning, and stating
 * a calendar date for a working-day clock is how a coordinator misses it over
 * a weekend.
 */
export function freeTimeExpiresOn(
  cfg: ClockConfig,
  window: Pick<ClockWindow, 'startedOn'>,
  calendar: WorkingCalendar,
): CalendarDate {
  const start = toCalendarDate(window.startedOn, calendar)
  const basis = cfg.dayBasis ?? 'calendar'

  /*
    Free days are inclusive of the start day, so the last free day is
    `freeDays - 1` after it. A clock with zero free days expired the day it
    started, which `Math.max` keeps from walking backwards into last week.
  */
  const offset = Math.max(0, cfg.freeDays - 1)
  return basis === 'working'
    ? addWorkingDays(start, offset, calendar)
    : addCalendarDays(start, offset)
}
