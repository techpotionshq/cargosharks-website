/**
 * Sealing a credential that has to be given back.
 *
 * Everything else secret in this system is hashed, because nothing needs the
 * original again. A mailbox password is the exception — the poll worker has to
 * present it to the mail server — so it is encrypted, which is a materially
 * weaker position and the one that needs its properties pinned.
 *
 * Three of the cases below are the ones that matter:
 *
 *   - **A tampered ciphertext fails to open.** GCM authenticates, and this is
 *     the whole reason for choosing it: a row altered in the database must not
 *     decrypt to rubbish that is then handed to a mail server as a password.
 *   - **A different key fails to open.** Obvious, and the case that proves the
 *     key is doing work rather than the format being reversible on its own.
 *   - **Two seals of the same secret differ.** A fresh IV per seal is what GCM
 *     requires, and reuse is its catastrophic misuse. Identical ciphertexts
 *     would be the visible symptom of a fixed IV.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasSecretKey, open, seal, SealedSecretError, SecretKeyError } from '../src/secrets'

const KEY_A = Buffer.alloc(32, 1).toString('base64')
const KEY_B = Buffer.alloc(32, 2).toString('base64')

const original = process.env.MAILBOX_ENCRYPTION_KEY

beforeEach(() => {
  process.env.MAILBOX_ENCRYPTION_KEY = KEY_A
})

afterEach(() => {
  if (original === undefined) delete process.env.MAILBOX_ENCRYPTION_KEY
  else process.env.MAILBOX_ENCRYPTION_KEY = original
})

describe('seal and open', () => {
  it('round-trips a password', () => {
    expect(open(seal('correct horse battery staple'))).toBe('correct horse battery staple')
  })

  /** Mail passwords are not ASCII in every office that will run this. */
  it('round-trips a non-Latin password', () => {
    const secret = 'كلمة-المرور-٢٠٢٦'
    expect(open(seal(secret))).toBe(secret)
  })

  it('produces the versioned four-part shape the database checks for', () => {
    // The check constraint in 0027 is this pattern. If the format changes here
    // and not there, every insert fails — which is the point of both.
    expect(seal('x')).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/)
  })

  it('never produces the same ciphertext twice for one secret', () => {
    const seals = new Set(Array.from({ length: 20 }, () => seal('same-password')))
    expect(seals.size).toBe(20)
  })

  it('leaves no trace of the plaintext in the ciphertext', () => {
    expect(seal('shibboleth')).not.toContain('shibboleth')
    expect(seal('shibboleth')).not.toContain(Buffer.from('shibboleth').toString('base64'))
  })

  it('refuses to seal nothing', () => {
    expect(() => seal('')).toThrow(SealedSecretError)
  })
})

describe('open refuses what it should', () => {
  it('refuses a ciphertext sealed under a different key', () => {
    const sealed = seal('the-password')
    process.env.MAILBOX_ENCRYPTION_KEY = KEY_B
    expect(() => open(sealed)).toThrow(SealedSecretError)
  })

  /**
   * The bug this is here to catch.
   *
   * Without authentication a modified ciphertext decrypts to *something*, and
   * that something is then presented to a mail server as a password. GCM turns
   * that into a loud failure at the point of the tampering rather than a
   * mysterious authentication failure at the far end.
   */
  it('refuses a ciphertext whose body has been altered', () => {
    const [scheme, iv, tag, body] = seal('the-password').split(':')
    const flipped = Buffer.from(body!, 'base64')
    flipped[0]! ^= 0xff

    expect(() => open([scheme, iv, tag, flipped.toString('base64')].join(':'))).toThrow(
      SealedSecretError,
    )
  })

  it('refuses a ciphertext whose authentication tag has been altered', () => {
    const [scheme, iv, tag, body] = seal('the-password').split(':')
    const flipped = Buffer.from(tag!, 'base64')
    flipped[0]! ^= 0xff

    expect(() => open([scheme, iv, flipped.toString('base64'), body].join(':'))).toThrow(
      SealedSecretError,
    )
  })

  it('refuses a value that is not sealed at all', () => {
    for (const junk of ['', 'plaintext-password', 'v1:only:three', 'v9:a:b:c']) {
      expect(() => open(junk)).toThrow(SealedSecretError)
    }
  })
})

describe('the key itself', () => {
  it('reports whether one is configured', () => {
    expect(hasSecretKey()).toBe(true)
    delete process.env.MAILBOX_ENCRYPTION_KEY
    expect(hasSecretKey()).toBe(false)
  })

  it('names the fix when there is no key', () => {
    delete process.env.MAILBOX_ENCRYPTION_KEY
    expect(() => seal('x')).toThrow(SecretKeyError)
    expect(() => seal('x')).toThrow(/randomBytes\(32\)/)
  })

  /**
   * A passphrase is not a key, and accepting one quietly would give the key
   * the entropy of a word somebody typed. The error says the size it wanted.
   */
  it('refuses a key that is not 32 bytes', () => {
    process.env.MAILBOX_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64')
    expect(() => seal('x')).toThrow(/must be 32 bytes/)

    process.env.MAILBOX_ENCRYPTION_KEY = 'hunter2'
    expect(() => seal('x')).toThrow(SecretKeyError)
  })
})

/**
 * GCM lets a tag be truncated, and a truncated tag is a cheaper forgery.
 *
 * Without `authTagLength` on the cipher, Node verifies against whatever length
 * `setAuthTag` is handed — so an attacker who can rewrite the row also chooses
 * how hard their forgery has to be, and four bytes is a one-in-four-billion
 * check rather than a 128-bit one. Naming the length moves that choice back to
 * us.
 *
 * The first case is the one that would silently regress: it passes both with
 * and without the fix for the wrong reason unless the tag is *valid* and
 * merely short, so it is built by truncating a real tag rather than by
 * inventing one.
 */
describe('the authentication tag', () => {
  it('refuses a tag shorter than the one it writes', () => {
    const [scheme, iv, tag, body] = seal('a mailbox password').split(':')
    const truncated = Buffer.from(tag!, 'base64').subarray(0, 4).toString('base64')

    expect(() => open([scheme, iv, truncated, body].join(':'))).toThrow(SealedSecretError)
  })

  it('still opens a secret sealed with the full tag', () => {
    expect(open(seal('a mailbox password'))).toBe('a mailbox password')
  })
})
