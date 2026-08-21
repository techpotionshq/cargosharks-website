/**
 * Integration configuration, read from rows and cached briefly.
 *
 * `config.ts` validates the environment once at boot and says why: *"a missing
 * WhatsApp token should stop the service at start-up with a clear message, not
 * surface at 2am as a failed notification for a shipment that has already
 * sailed."* That argument is still right about the environment and it does not
 * survive being applied to rows, for one reason that is easy to miss until it
 * happens to you:
 *
 * **A bad row must never stop the service.** If it did, an administrator who
 * mistyped a gateway path would take down the application — including the
 * settings screen that is the only place to correct it. The deployment would
 * be unrecoverable without a psql session, which is precisely the position
 * moving configuration into the interface was meant to end.
 *
 * So the two layers fail differently, deliberately:
 *
 *   environment    invalid at boot, refuse to start (unchanged)
 *   row            invalid at resolve, fall back to the safe driver, record
 *                  the reason on the row, and let the screen show it red
 *
 * Validation still happens *early* for rows — the server action rejects a save
 * the catalogue says is incomplete. This is the second line, for the states a
 * form cannot catch: a key that was right in March and revoked in June.
 *
 * ## Why a cache, and why a short one
 *
 * The alternative to caching is a query per notification and per poll. The
 * alternative to expiring is a restart to pick up a change, which is the thing
 * being removed. Thirty seconds is the compromise, and it is chosen from the
 * user's side rather than the database's: an administrator who saves a relay
 * and sends a test expects it to have taken effect by the time they have
 * finished reading the confirmation.
 *
 * `resolveInboundMail` in `adapters/index.ts` already set this precedent for
 * the mailbox list, on the same reasoning — *"a mailbox added at 09:05 must be
 * read at 09:06, not at the next restart."*
 */

import {
  openSecret,
  resolveIntegrations,
  systemActor,
  withActor,
  integrationSettings,
  type ResolvedIntegration,
} from '@qabandi/db'
import { eq } from 'drizzle-orm'
import { integrationSpec } from '@qabandi/core'

/** How long a resolved snapshot is reused. See the note above on the number. */
const CACHE_MS = 30_000

let cache: { at: number; map: Map<string, ResolvedIntegration> } | undefined

/**
 * Drop the cache.
 *
 * For tests, which must not inherit a snapshot from each other. There is
 * deliberately no route that calls this: a save takes effect within the window
 * above, and an endpoint whose only job is to shave thirty seconds off that
 * would be a second way for `apps/web` to reach into the service's memory —
 * one more thing to authenticate, and one more thing to be wrong when a
 * deployment runs two service replicas and the ping reaches one of them.
 */
export function invalidateSettings(): void {
  cache = undefined
}

async function snapshot(): Promise<Map<string, ResolvedIntegration>> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.map

  try {
    const map = await withActor(systemActor(), (tx) => resolveIntegrations(tx))
    cache = { at: now, map }
    return map
  } catch (error) {
    /*
      A database that cannot be read must not become a configuration error.

      Falling back to an environment-only resolution keeps every deployment
      that has configured nothing here working exactly as before, and keeps a
      transient connection failure from reading as "the SMTP relay is gone".
      Not cached — the next call tries the database again.
    */
    console.error({ err: error }, 'integration settings unreadable; using the environment alone')
    return new Map()
  }
}

/**
 * One integration's resolved configuration, in the shapes callers actually
 * want.
 *
 * The accessors coerce rather than the caller, because `settings` is JSON and
 * a form posts strings: a port arriving as `"587"` and being compared to `587`
 * is the bug this shape exists to make unavailable.
 */
export interface LiveIntegration {
  readonly key: string
  readonly driver: string | undefined
  /** Whether the chosen driver is one that needs credentials. */
  readonly live: boolean
  /** Required fields and secrets with no value in either layer. */
  readonly missing: readonly string[]
  /**
   * Whether an active row supplied any of this — for the boot log, and only
   * for it. "The relay is wrong" and "the relay you edited is not the one in
   * use" are different problems with one symptom, and this is what separates
   * them in the one place somebody looks first.
   */
  readonly fromRow: boolean
  text(name: string): string | undefined
  number(name: string, fallback: number): number
  bool(name: string, fallback: boolean): boolean
  /** The plaintext credential — sealed row first, environment beneath it. */
  secret(name: string): string | undefined
}

/**
 * The environment-only answer, for the two cases that have no row to read:
 * before the first save, and when the database cannot be reached.
 */
function envOnly(key: string): LiveIntegration {
  const spec = integrationSpec(key)
  const value = (name: string): string | undefined => {
    const field = spec?.fields.find((f) => f.name === name)
    const raw = field ? process.env[field.env]?.trim() : undefined
    return raw === '' ? undefined : raw
  }

  return {
    key,
    driver:
      (spec?.driverEnv ? process.env[spec.driverEnv]?.trim() : undefined) || spec?.defaultDriver,
    live: true,
    missing: [],
    fromRow: false,
    text: value,
    number: (name, fallback) => {
      const parsed = Number(value(name))
      return Number.isFinite(parsed) ? parsed : fallback
    },
    bool: (name, fallback) => {
      const raw = value(name)
      return raw === undefined ? fallback : raw !== 'false' && raw !== '0'
    },
    secret: (name) => {
      const secret = spec?.secrets.find((s) => s.name === name)
      const raw = secret ? process.env[secret.env]?.trim() : undefined
      return raw === '' ? undefined : raw
    },
  }
}

function wrap(resolved: ResolvedIntegration): LiveIntegration {
  return {
    key: resolved.key,
    driver: resolved.driver,
    live: resolved.live,
    missing: resolved.missing,
    fromRow:
      resolved.driverSource === 'row' ||
      Object.values(resolved.sources).includes('row') ||
      Object.values(resolved.sealed).some((value) => value !== undefined),

    text: (name) => resolved.settings[name],

    number: (name, fallback) => {
      const parsed = Number(resolved.settings[name])
      return Number.isFinite(parsed) ? parsed : fallback
    },

    /*
      Anything but `false` and `0` is true, and *absent* is the fallback.

      The distinction matters for `SMTP_TLS_REJECT_UNAUTHORIZED`, whose
      fallback is `true`: reading an unset value as false would silently
      disable certificate verification on every deployment that had not
      thought about it, which is the one failure in this file that is a
      security bug rather than an outage.
    */
    bool: (name, fallback) => {
      const raw = resolved.settings[name]
      return raw === undefined ? fallback : raw !== 'false' && raw !== '0'
    },

    secret: (name) => {
      const sealed = resolved.sealed[name]

      if (sealed) {
        try {
          return openSecret(sealed)
        } catch (error) {
          /*
            A credential sealed under a rotated key, most likely.

            Falls through to the environment rather than throwing, for the same
            reason one unreadable mailbox does not stop the others: a key
            rotation that stranded the Maersk secret should not also take out
            the SMTP relay that would have told somebody about it.
          */
          console.error(
            { err: error, integration: resolved.key, secret: name },
            'sealed credential could not be opened',
          )
        }
      }

      const spec = resolved.spec.secrets.find((s) => s.name === name)
      const raw = spec ? process.env[spec.env]?.trim() : undefined
      return raw === '' ? undefined : raw
    },
  }
}

/** One integration, resolved. Never throws — see the note at the top. */
export async function integration(key: string): Promise<LiveIntegration> {
  const resolved = (await snapshot()).get(key)
  return resolved ? wrap(resolved) : envOnly(key)
}

/**
 * Record what an integration did, so the settings screen can show it.
 *
 * The counterpart to `noteMailboxError`, and it exists for a worse failure
 * than that one. A mailbox that stops working makes the enquiry queue go
 * quiet, which somebody eventually notices. A carrier key that stops working
 * makes shipments stop moving on the board, which looks exactly like
 * shipments not moving — there is no queue to be empty and nothing to notice.
 *
 * Writes nothing when there is no row: an integration configured purely from
 * the environment has nowhere to record this, and inserting a row to hold an
 * error would silently take over the configuration from the environment on
 * the next read.
 */
export async function noteIntegrationResult(key: string, error: string | null): Promise<void> {
  const now = new Date()

  await withActor(systemActor(), async (tx) => {
    await tx
      .update(integrationSettings)
      .set({
        lastCheckedAt: now,
        lastError: error,
        ...(error ? {} : { lastOkAt: now }),
      })
      .where(eq(integrationSettings.key, key))
  })
}
