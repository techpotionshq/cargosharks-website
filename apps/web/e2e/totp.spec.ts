/**
 * The RFC's own vectors for the TOTP helper the sign-in setup depends on.
 *
 * A subtly wrong TOTP is the worst kind of wrong: a broken counter or a
 * mis-masked truncation still produces six plausible digits, so the suite that
 * depends on it does not fail loudly — it fails at sign-in, intermittently, and
 * reads as flake.
 *
 * A Playwright spec rather than a vitest one because `vitest.config.ts`
 * excludes `e2e/**` — that directory belongs to this runner. It needs no
 * browser and no page; it is pure arithmetic, and it costs milliseconds.
 *
 * RFC 6238 Appendix B publishes SHA-1 vectors for the ASCII secret
 * `12345678901234567890` (`GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` in base32). The
 * published values are eight digits; a six-digit authenticator shows the last
 * six, which is what is asserted.
 */

import { expect, test } from '@playwright/test'
import { base32Decode, totp } from './support/totp'

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

const VECTORS: readonly (readonly [number, string])[] = [
  [59, '287082'],
  [1_111_111_109, '081804'],
  [1_111_111_111, '050471'],
  [1_234_567_890, '005924'],
  [2_000_000_000, '279037'],
  // Past 2^32 seconds, which is where a 32-bit counter write silently wraps.
  [20_000_000_000, '353130'],
] as const

test.describe('totp', () => {
  test('decodes the RFC 4648 secret to its ASCII form', () => {
    expect(base32Decode(SECRET).toString('utf8')).toBe('12345678901234567890')
  })

  test('tolerates the spacing and case an authenticator prints', () => {
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(base32Decode(SECRET))
  })

  test('refuses a character that is not base32', () => {
    expect(() => base32Decode('ABC1')).toThrow(/not base32/)
  })

  test('matches every published RFC 6238 code', () => {
    for (const [seconds, expected] of VECTORS) {
      expect(totp(SECRET, seconds * 1000), `T=${seconds}`).toBe(expected)
    }
  })

  test('always returns six digits, zero-padded', () => {
    for (let step = 0; step < 200; step++) {
      expect(totp(SECRET, step * 30_000)).toMatch(/^\d{6}$/)
    }
  })
})
