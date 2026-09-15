/**
 * A TOTP code, for the suite that has to enrol a second factor.
 *
 * `administrator` and `finance` carry `requires_two_factor` (FR-ID-06), and the
 * shells send an unenrolled principal to `/two-factor/enrol` before any screen
 * renders. The seeded suite signs in as an administrator, so it meets that gate
 * on the first navigation and has to pass it the way an operator does.
 *
 * Written here rather than taken from a dependency. It is thirty lines of RFC
 * 4648 and RFC 6238, it runs only in tests, and a new package in the lockfile
 * costs a supply-chain review that this does not deserve. It is checked against
 * the RFC's own vectors in `totp.test.ts`, which is the reason to trust it.
 */

import { createHmac } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, the encoding every authenticator app expects. */
export function base32Decode(input: string): Buffer {
  // Padding and case are cosmetic; authenticators print the secret grouped and
  // upper-case, and a person retyping it will not reproduce either faithfully.
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()

  let bits = 0
  let value = 0
  const out: number[] = []

  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) throw new Error(`not base32: ${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(out)
}

/**
 * The six digits for a moment in time.
 *
 * `atMs` is a parameter rather than a call to `Date.now()` so the test vectors
 * can pin it. Default is now, which is what the suite wants.
 */
export function totp(secretBase32: string, atMs: number = Date.now(), digits = 6): string {
  const counter = Math.floor(atMs / 1000 / 30)

  // The counter is eight bytes, big-endian. `writeBigUInt64BE` rather than two
  // 32-bit writes because the high half is not zero forever.
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', base32Decode(secretBase32)).update(message).digest()

  // Dynamic truncation, RFC 4226 §5.4: the low nibble of the last byte picks
  // where the four-byte window starts, and the top bit is masked off so the
  // result is a positive 31-bit integer on every platform.
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!

  return String(binary % 10 ** digits).padStart(digits, '0')
}
