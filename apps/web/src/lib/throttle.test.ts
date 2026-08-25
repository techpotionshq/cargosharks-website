import { beforeEach, describe, expect, it } from 'vitest'
import { __resetThrottle, clearSignInAttempts, recordSignInAttempt } from './throttle'

const IP = '203.0.113.7'
const OTHER = '203.0.113.8'

/** The window and limit are private; these mirror them. */
const LIMIT = 10
const WINDOW_MS = 15 * 60 * 1000

beforeEach(() => {
  __resetThrottle()
})

describe('spending the budget', () => {
  it('allows the limit and refuses the one after it', () => {
    const now = 1_000_000

    for (let i = 0; i < LIMIT; i += 1) {
      expect(recordSignInAttempt(IP, now + i).allowed).toBe(true)
    }

    const refused = recordSignInAttempt(IP, now + LIMIT)
    expect(refused.allowed).toBe(false)
    expect(refused.minutesRemaining).toBeGreaterThan(0)
  })

  it('keeps addresses apart', () => {
    const now = 1_000_000
    for (let i = 0; i < LIMIT + 1; i += 1) recordSignInAttempt(IP, now + i)

    // The neighbour on a different address is unaffected.
    expect(recordSignInAttempt(OTHER, now).allowed).toBe(true)
  })

  it('opens a fresh window once the old one has run out', () => {
    const now = 1_000_000
    for (let i = 0; i < LIMIT + 1; i += 1) recordSignInAttempt(IP, now + i)
    expect(recordSignInAttempt(IP, now + LIMIT + 1).allowed).toBe(false)

    expect(recordSignInAttempt(IP, now + WINDOW_MS + 1).allowed).toBe(true)
  })

  /*
    Counting every attempt rather than only the failures is the point: an
    attacker walking a list of addresses to see which exist never causes a
    failed password check against a real account.
  */
  it('counts attempts, not failures — the caller does not get to say', () => {
    const now = 1_000_000
    for (let i = 0; i < LIMIT; i += 1) recordSignInAttempt(IP, now)
    expect(recordSignInAttempt(IP, now).allowed).toBe(false)
  })
})

describe('the address we could not read', () => {
  /*
    Fails open, deliberately. A missing `x-forwarded-for` means a proxy that is
    misconfigured, and failing closed there would lock every operator out of
    the product at once — with the persistent account lock still behind it.
  */
  it('lets a null address through every time', () => {
    for (let i = 0; i < LIMIT * 3; i += 1) {
      expect(recordSignInAttempt(null, 1_000_000).allowed).toBe(true)
    }
  })

  it('does not throw when clearing one', () => {
    expect(() => clearSignInAttempts(null)).not.toThrow()
  })
})

describe('clearing after a success', () => {
  /*
    The shared-office case. Ten people behind one NAT address would otherwise
    spend a common budget on ordinary Sunday-morning sign-ins and lock the
    eleventh out of a working product.
  */
  it('returns the full budget to an address that signed in', () => {
    const now = 1_000_000
    for (let i = 0; i < LIMIT; i += 1) recordSignInAttempt(IP, now + i)

    clearSignInAttempts(IP)

    for (let i = 0; i < LIMIT; i += 1) {
      expect(recordSignInAttempt(IP, now + LIMIT + i).allowed).toBe(true)
    }
  })
})

describe('the ceiling on tracked addresses', () => {
  /*
    The keys arrive from unauthenticated requests and IPv6 hands an attacker
    effectively unlimited ones, so the map has to be bounded or the throttle
    becomes the memory exhaustion it exists to prevent.

    Asserted by behaviour rather than by reading the map: a run far past the
    cap must still answer, and must still refuse the address that is over its
    own budget.
  */
  it('survives far more addresses than it tracks', () => {
    const now = 1_000_000
    for (let i = 0; i < 12_000; i += 1) {
      expect(recordSignInAttempt(`198.51.100.${i}`, now).allowed).toBe(true)
    }

    // A fresh address is still served correctly after the flood.
    for (let i = 0; i < LIMIT; i += 1) {
      expect(recordSignInAttempt(IP, now).allowed).toBe(true)
    }
    expect(recordSignInAttempt(IP, now).allowed).toBe(false)
  })
})
