import { describe, expect, it } from 'vitest'
import {
  LOCKOUT_DURATION_MS,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MS,
  afterFailure,
  afterSuccess,
  lockoutState,
  type LockoutCounters,
} from '../src/index'

const CLEAN: LockoutCounters = { failedCount: 0, lastFailedAt: null, lockedUntil: null }

const at = (iso: string) => new Date(iso)
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms)

/** Fail `times` in quick succession, a second apart, starting at `start`. */
function failRun(times: number, start: Date, from: LockoutCounters = CLEAN): LockoutCounters {
  let counters = from
  for (let i = 0; i < times; i += 1) counters = afterFailure(counters, plus(start, i * 1000))
  return counters
}

describe('counting failures', () => {
  it('starts at one and climbs', () => {
    const start = at('2026-08-25T09:00:00Z')
    expect(afterFailure(CLEAN, start).failedCount).toBe(1)
    expect(failRun(3, start).failedCount).toBe(3)
  })

  it('does not lock below the threshold', () => {
    const counters = failRun(LOCKOUT_THRESHOLD - 1, at('2026-08-25T09:00:00Z'))
    expect(counters.lockedUntil).toBeNull()
  })

  it('locks on the threshold attempt, for the stated duration', () => {
    const start = at('2026-08-25T09:00:00Z')
    const counters = failRun(LOCKOUT_THRESHOLD, start)

    expect(counters.failedCount).toBe(LOCKOUT_THRESHOLD)
    // The lock runs from the *last* failure, not from the first.
    const last = plus(start, (LOCKOUT_THRESHOLD - 1) * 1000)
    expect(counters.lockedUntil).toEqual(plus(last, LOCKOUT_DURATION_MS))
  })

  /*
    The forgiveness rule, which is the one that stops the control turning on
    the staff it protects. Without it the counter is a lifetime total and an
    operator who mistypes twice a quarter locks themselves out eventually.
  */
  it('forgives a run that has gone quiet, and starts again from one', () => {
    const start = at('2026-08-25T09:00:00Z')
    const four = failRun(4, start)
    expect(four.failedCount).toBe(4)

    const muchLater = plus(four.lastFailedAt!, LOCKOUT_WINDOW_MS + 1000)
    expect(afterFailure(four, muchLater).failedCount).toBe(1)
  })

  it('keeps counting inside the window', () => {
    const start = at('2026-08-25T09:00:00Z')
    const four = failRun(4, start)

    const justInside = plus(four.lastFailedAt!, LOCKOUT_WINDOW_MS - 1000)
    const fifth = afterFailure(four, justInside)
    expect(fifth.failedCount).toBe(LOCKOUT_THRESHOLD)
    expect(fifth.lockedUntil).not.toBeNull()
  })
})

describe('reading the lock', () => {
  it('is open when nothing is stored', () => {
    expect(lockoutState(CLEAN, at('2026-08-25T09:00:00Z')).locked).toBe(false)
  })

  it('is shut while the lock stands, and reports whole minutes', () => {
    const now = at('2026-08-25T09:00:00Z')
    const counters: LockoutCounters = { ...CLEAN, lockedUntil: plus(now, 5 * 60_000) }

    const state = lockoutState(counters, now)
    expect(state.locked).toBe(true)
    expect(state.minutesRemaining).toBe(5)
  })

  /*
    Rounded up, deliberately. Telling somebody to come back in a minute and
    then refusing them again 59 seconds later is how a control earns a
    reputation for being broken.
  */
  it('rounds a part-minute up rather than down', () => {
    const now = at('2026-08-25T09:00:00Z')
    const counters: LockoutCounters = { ...CLEAN, lockedUntil: plus(now, 61_000) }
    expect(lockoutState(counters, now).minutesRemaining).toBe(2)
  })

  /*
    The lock has to lift on its own. A lock only an administrator can clear
    turns any address an attacker knows into a way to take a named person off
    the system for the working day — the denial of service arrives dressed as
    the control meant to prevent one.
  */
  it('lifts by itself once the duration has passed', () => {
    const start = at('2026-08-25T09:00:00Z')
    const locked = failRun(LOCKOUT_THRESHOLD, start)

    const during = plus(locked.lockedUntil!, -1000)
    expect(lockoutState(locked, during).locked).toBe(true)

    const after = plus(locked.lockedUntil!, 1000)
    expect(lockoutState(locked, after).locked).toBe(false)
  })

  it('treats the exact expiry instant as open', () => {
    const now = at('2026-08-25T09:00:00Z')
    expect(lockoutState({ ...CLEAN, lockedUntil: now }, now).locked).toBe(false)
  })

  /*
    `lockedUntil` alone decides. Lowering the threshold later must not
    retroactively lock every account sitting on old failures.
  */
  it('ignores the counter when no lock is stored', () => {
    const counters: LockoutCounters = {
      failedCount: LOCKOUT_THRESHOLD + 10,
      lastFailedAt: at('2026-08-25T09:00:00Z'),
      lockedUntil: null,
    }
    expect(lockoutState(counters, at('2026-08-25T09:00:01Z')).locked).toBe(false)
  })
})

describe('signing in successfully', () => {
  it('clears the run and the lock together', () => {
    expect(afterSuccess()).toEqual(CLEAN)
  })

  it('leaves an account that had failed four times back at zero', () => {
    const four = failRun(4, at('2026-08-25T09:00:00Z'))
    expect(four.failedCount).toBe(4)
    expect(afterSuccess().failedCount).toBe(0)
  })
})
