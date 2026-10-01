/**
 * Sealing a credential that has to be given back — `mailboxes.password_sealed`.
 *
 * Almost every secret in this system is *verified*, never replayed: an API key
 * is hashed (SHA-256 — it is 256 random bits, so a slow KDF would buy nothing)
 * and compared, a session token is looked up. Those are hashes,
 * and a hash is the right answer because nothing ever needs the original back.
 *
 * An IMAP password is the exception. The poll worker has to present it to the
 * mail server on every connection, so it must be recoverable, so it must be
 * encrypted rather than hashed. That is a materially weaker position and the
 * design has to earn it.
 *
 * ## The key is not in the database
 *
 * `MAILBOX_ENCRYPTION_KEY` lives in the environment, and that is the whole
 * point of the exercise. `mailboxes` is a row like any other: it is in every
 * `pnpm fleet:backup`, every restore drill, every replica, and every dump
 * somebody takes to debug something. If the key travelled with the ciphertext
 * then none of those would be safe to hand anybody, and "encrypted at rest"
 * would be a sentence rather than a property.
 *
 * This matters more here than for most credentials. A forwarding desk's
 * mailbox password is very often the staff member's whole account password,
 * because that is how mail accounts are issued in an office of this size.
 *
 * ## AES-256-GCM, and why authenticated encryption specifically
 *
 * GCM authenticates as well as encrypts, so a ciphertext altered in the
 * database fails to open rather than decrypting to rubbish that is then handed
 * to a mail server as a password. The failure is loud and in the right place.
 *
 * A fresh 96-bit IV per seal, which is what GCM requires — reusing one across
 * two seals under the same key is the catastrophic misuse of this mode, so no
 * caller is given the opportunity to supply it.
 *
 * ## The version prefix
 *
 * `v1:` costs six bytes and buys the ability to rotate. Re-keying a fleet
 * without it means guessing which rows are in which scheme, which is the point
 * at which people decide not to rotate at all.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const SCHEME = 'v1'
const ALGORITHM = 'aes-256-gcm'

/**
 * The authentication tag length, in bytes, stated rather than assumed.
 *
 * GCM's tag may legitimately be truncated, and Node lets `setAuthTag` accept
 * whichever length it is handed unless the cipher was told what to expect. So
 * a row rewritten to carry a four-byte tag is verified against four bytes —
 * and a forgery only has to survive a one-in-four-billion check instead of the
 * full 128-bit one. The attacker controls the tag, which means the attacker
 * controls the difficulty, which is not a property worth leaving to a default.
 *
 * Sixteen is what `getAuthTag` already produces here, so nothing about the
 * stored format changes and every secret sealed by an earlier build still
 * opens. This only refuses the short tags that were never written by us.
 */
const TAG_BYTES = 16
const IV_BYTES = 12
const KEY_BYTES = 32

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretKeyError'
  }
}

export class SealedSecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealedSecretError'
  }
}

/**
 * The key, read at use rather than at import.
 *
 * At import would mean every command that touches `@qabandi/db` — migrations,
 * the seed, a one-off script — refusing to start over a variable only the mail
 * poller and one settings screen need.
 */
function key(): Buffer {
  const configured = process.env.MAILBOX_ENCRYPTION_KEY?.trim()

  if (!configured) {
    throw new SecretKeyError(
      'MAILBOX_ENCRYPTION_KEY is not set, so mailbox passwords can be neither ' +
        'stored nor read. Generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    )
  }

  /*
    Base64 of 32 raw bytes, not a passphrase.

    Accepting a passphrase would mean deriving a key from it, and a derivation
    nobody specified is one somebody will do with a single unsalted SHA-256 —
    at which point the key has the entropy of the passphrase, which is to say
    the entropy of a word somebody typed.
  */
  const raw = Buffer.from(configured, 'base64')

  if (raw.byteLength !== KEY_BYTES) {
    throw new SecretKeyError(
      `MAILBOX_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-encoded — ` +
        `this one decodes to ${raw.byteLength}. Generate one with:\n` +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    )
  }

  return raw
}

/** Whether a key is configured, for the boot log and the settings screen. */
export function hasSecretKey(): boolean {
  return secretKeyProblem() === null
}

/**
 * Why the key cannot be used, or null when it can.
 *
 * `hasSecretKey()` collapses two very different states into one `false`, and
 * the screens that consumed it told the reader the wrong one: a key that is
 * *set but the wrong shape* was reported as "not set on this deployment",
 * which sends somebody to check whether a variable exists when it plainly
 * does. A passphrase pasted in place of 32 base64 bytes is the common way in
 * — it looks like a secret, and every other secret in the environment is one.
 *
 * `key()` already produces the precise message, including the command that
 * generates a valid one. This hands it back rather than throwing it away.
 */
export function secretKeyProblem(): string | null {
  try {
    key()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * The same answer as `secretKeyProblem`, as data rather than an English
 * sentence — for a screen that has to say it in the reader's language (U1).
 *
 * The message above is for logs and the boot check, where English is right.
 * The settings screen used to print it verbatim, on Arabic pages too.
 */
export type SecretKeyStatus =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'missing' }
  | {
      readonly ok: false
      readonly reason: 'length'
      readonly bytes: number
      readonly expected: number
    }

export function secretKeyStatus(): SecretKeyStatus {
  const configured = process.env.MAILBOX_ENCRYPTION_KEY?.trim()
  if (!configured) return { ok: false, reason: 'missing' }
  const bytes = Buffer.from(configured, 'base64').byteLength
  return bytes === KEY_BYTES
    ? { ok: true }
    : { ok: false, reason: 'length', bytes, expected: KEY_BYTES }
}

/** The command that prints a valid key, for a screen to show beside the reason. */
export const SECRET_KEY_COMMAND =
  "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""

/** `v1:<iv>:<tag>:<ciphertext>`, each part base64. */
export function seal(plaintext: string): string {
  if (plaintext === '') throw new SealedSecretError('Refusing to seal an empty secret.')

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv, { authTagLength: TAG_BYTES })
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [
    SCHEME,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join(':')
}

export function open(sealed: string): string {
  const [scheme, iv, tag, body] = sealed.split(':')

  if (scheme !== SCHEME || !iv || !tag || !body) {
    throw new SealedSecretError(
      `Not a sealed secret this build understands (scheme "${scheme ?? 'none'}").`,
    )
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64'), {
      authTagLength: TAG_BYTES,
    })
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
      'utf8',
    )
  } catch (error) {
    /*
      A key error passes through; anything else becomes one sentence.

      `final()` throws the same unhelpful "unable to authenticate data" for a
      wrong key, a rotated key and a tampered row, and the operator's next step
      differs for each. Naming all three is the most honest thing this layer
      can say, because it genuinely cannot tell them apart — that is what
      authentication means.
    */
    if (error instanceof SecretKeyError) throw error

    /*
      "Credential", not "mailbox password".

      The variable is named for the mailboxes because they sealed first, but
      this function opens every secret in the system — the OpenRouter key, the
      carrier credentials, the SMTP password — and the old wording sent an
      operator to the mailbox screen when the row that would not open was the
      AI integration's. The caller logs which integration and which secret;
      this sentence only has to be true for all of them.
    */
    throw new SealedSecretError(
      'This sealed credential could not be opened. Either MAILBOX_ENCRYPTION_KEY ' +
        'is not the key it was sealed with, or the stored value has been altered. ' +
        'Re-enter the credential where it was set — the mailbox, or Settings › ' +
        'Integrations — to seal it again under the current key.',
    )
  }
}
