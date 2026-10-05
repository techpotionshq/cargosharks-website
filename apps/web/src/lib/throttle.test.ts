import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetThrottle,
  checkSignInAddress,
  checkTwoFactorAddress,
  clearSignInFailuresInMemory,
  clearTwoFactorFailures,
  readTwoFactorLock,
  recordTwoFactorFailureInMemory,
  readEmailLock,
  recordSignInFailureInMemory,
  recordTrackingLookup,
  recordTrackingMiss,
} from './throttle'

const IP = '203.0.113.7'
const OTHER = '203.0.113.8'

/** The window and limits are private; these mirror them. */
const ADDRESS_FAILURES = 50
const WINDOW_MS = 15 * 60 * 1000
const ACCOUNT_FAILURES = 5

beforeEach(() => {
  __resetThrottle()
})

describe('the per-address failure budget', () => {
  it('allows the limit of failures and refuses after it', () => {
    const now = 1_000_000
    for (let i = 0; i < ADDRESS_FAILURES; i += 1) {
      expect(checkSignInAddress(IP, now + i).allowed).toBe(true)
      recordSignInFailureInMemory(IP, `m${i}@b.test`, now + i)
    }
    const refused = checkSignInAddress(IP, now + ADDRESS_FAILURES)
    expect(refused.allowed).toBe(false)
    expect(refused.minutesRemaining).toBeGreaterThan(0)
  })

  it('keeps addresses apart', () => {
    const now = 1_000_000
    for (let i = 0; i < ADDRESS_FAILURES; i += 1) recordSignInFailureInMemory(IP, null, now)
    expect(checkSignInAddress(OTHER, now).allowed).toBe(true)
  })

  it('opens a fresh window once the old one has run out', () => {
    const now = 1_000_000
    for (let i = 0; i < ADDRESS_FAILURES; i += 1) recordSignInFailureInMemory(IP, null, now)
    expect(checkSignInAddress(IP, now + 1).allowed).toBe(false)
    expect(checkSignInAddress(IP, now + WINDOW_MS + 1).allowed).toBe(true)
  })

  /*
    R11: checking the budget spends nothing. Only a failure does, so a whole
    office signing in correctly from one address is never refused.
  */
  it('is not spent by checking it, however many people sign in', () => {
    for (let i = 0; i < 500; i += 1) expect(checkSignInAddress(IP, 1_000_000).allowed).toBe(true)
  })

  it('is not refunded when somebody signs in', () => {
    const now = 1_000_000
    for (let i = 0; i < ADDRESS_FAILURES; i += 1)
      recordSignInFailureInMemory(IP, `m${i}@b.test`, now)
    clearSignInFailuresInMemory('m0@b.test')
    expect(checkSignInAddress(IP, now).allowed).toBe(false)
  })
})

describe('the per-account lock in memory', () => {
  it('locks any address at the fifth failure, whether or not it has an account', () => {
    const now = 1_000_000
    for (let i = 0; i < ACCOUNT_FAILURES - 1; i += 1) {
      recordSignInFailureInMemory(`198.51.100.${i}`, 'nobody@b.test', now)
      expect(readEmailLock('nobody@b.test', now).allowed).toBe(true)
    }
    recordSignInFailureInMemory('198.51.100.9', 'nobody@b.test', now)
    const lock = readEmailLock('nobody@b.test', now)
    expect(lock).toEqual({ allowed: false, minutesRemaining: 15 })
    // Somebody else's address is untouched.
    expect(readEmailLock('other@b.test', now).allowed).toBe(true)
  })

  it('lifts by itself after fifteen minutes', () => {
    const now = 1_000_000
    for (let i = 0; i < ACCOUNT_FAILURES; i += 1) recordSignInFailureInMemory(IP, 'a@b.test', now)
    expect(readEmailLock('a@b.test', now + WINDOW_MS + 1).allowed).toBe(true)
  })

  it('forgets the run after a correct password', () => {
    const now = 1_000_000
    for (let i = 0; i < ACCOUNT_FAILURES - 1; i += 1) {
      recordSignInFailureInMemory(IP, 'a@b.test', now)
    }
    clearSignInFailuresInMemory('a@b.test')
    recordSignInFailureInMemory(IP, 'a@b.test', now)
    expect(readEmailLock('a@b.test', now).allowed).toBe(true)
  })
})

describe('the address we could not read', () => {
  /*
    Fails open, deliberately. A missing `x-forwarded-for` means a proxy that is
    misconfigured, and failing closed there would lock every operator out of
    the product at once — with the per-account lock still behind it.
  */
  it('lets a null address through every time', () => {
    for (let i = 0; i < ADDRESS_FAILURES * 3; i += 1) {
      recordSignInFailureInMemory(null, null, 1_000_000)
      expect(checkSignInAddress(null, 1_000_000).allowed).toBe(true)
    }
  })

  it('does not throw when clearing a missing email', () => {
    expect(() => clearSignInFailuresInMemory(null)).not.toThrow()
  })
})

describe('the ceiling on tracked keys', () => {
  /*
    The keys arrive from unauthenticated requests and IPv6 hands an attacker
    effectively unlimited ones, so the maps have to be bounded or the throttle
    becomes the memory exhaustion it exists to prevent.
  */
  it('survives far more addresses and emails than it tracks', () => {
    const now = 1_000_000
    for (let i = 0; i < 12_000; i += 1) {
      recordSignInFailureInMemory(`198.51.100.${i}`, `flood${i}@b.test`, now)
    }
    for (let i = 0; i < ADDRESS_FAILURES; i += 1) recordSignInFailureInMemory(IP, 'a@b.test', now)
    expect(checkSignInAddress(IP, now).allowed).toBe(false)
    expect(readEmailLock('a@b.test', now).allowed).toBe(false)
  })
})

/*
  Public tracking — A10. The attack in the report: one shared LCL container
  number, walked against sequential references, from as many addresses as it
  takes.
*/
describe('the tracking budgets', () => {
  it('stops one container number being walked across references, whatever the address', () => {
    const now = 1_000_000
    for (let i = 0; i < 10; i += 1) {
      const reference = `KWI-2026-0${1000 + i}`
      expect(recordTrackingLookup(`198.51.100.${i}`, reference, 'MSCU1234567', now).allowed).toBe(
        true,
      )
      recordTrackingMiss(reference, 'MSCU1234567', now)
    }
    expect(
      recordTrackingLookup('198.51.100.99', 'KWI-2026-01999', 'MSCU1234567', now).allowed,
    ).toBe(false)
  })

  it('stops one reference being tried against guessed verifiers', () => {
    const now = 1_000_000
    for (let i = 0; i < 10; i += 1) recordTrackingMiss('KWI-2026-01041', `GUESS${i}`, now)
    expect(recordTrackingLookup(IP, 'KWI-2026-01041', 'GUESS99', now).allowed).toBe(false)
  })

  it('never spends the miss budgets on a customer who finds their shipment', () => {
    const now = 1_000_000
    for (let i = 0; i < 25; i += 1) {
      expect(recordTrackingLookup(IP, 'KWI-2026-01041', 'MSCU1234567', now).allowed).toBe(true)
    }
  })

  it('bounds the lookups from one address', () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i += 1) recordTrackingLookup(IP, `R${i}`, `V${i}`, now)
    expect(recordTrackingLookup(IP, 'R99', 'V99', now).allowed).toBe(false)
  })
})

/* The TOTP step, on the password step's terms. */
describe('the two-factor budgets', () => {
  it('locks one user at the fifth wrong code, and nobody else', () => {
    const now = 1_000_000
    for (let i = 0; i < 4; i += 1) recordTwoFactorFailureInMemory(IP, 'user-a', now)
    expect(readTwoFactorLock('user-a', now).allowed).toBe(true)
    recordTwoFactorFailureInMemory(IP, 'user-a', now)
    expect(readTwoFactorLock('user-a', now)).toEqual({ allowed: false, minutesRemaining: 15 })
    expect(readTwoFactorLock('user-b', now).allowed).toBe(true)
    expect(checkTwoFactorAddress(IP, now).allowed).toBe(true)
  })

  it('forgets the run after a correct code', () => {
    const now = 1_000_000
    for (let i = 0; i < 4; i += 1) recordTwoFactorFailureInMemory(IP, 'user-a', now)
    clearTwoFactorFailures('user-a')
    recordTwoFactorFailureInMemory(IP, 'user-a', now)
    expect(readTwoFactorLock('user-a', now).allowed).toBe(true)
  })

  it('refuses an address after fifty wrong codes, whoever they were for', () => {
    const now = 1_000_000
    for (let i = 0; i < 50; i += 1) recordTwoFactorFailureInMemory(IP, `user-${i}`, now)
    expect(checkTwoFactorAddress(IP, now).allowed).toBe(false)
    expect(checkTwoFactorAddress(OTHER, now).allowed).toBe(true)
  })
})
