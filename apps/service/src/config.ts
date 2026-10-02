/**
 * Environment, validated once at boot.
 *
 * A missing WhatsApp token should stop the service at start-up with a clear
 * message, not surface at 2am as a failed notification for a shipment that
 * has already sailed.
 *
 * ## Only what the service reads from the environment
 *
 * Everything an administrator can change on a screen — storage, the mail
 * relay, the FX feed, carrier keys, e-invoicing, the model — is an
 * `integration_settings` row (FR-AD-03), resolved by `settings.ts` with the
 * environment as the bootstrap layer beneath it. `packages/core/src/integrations.ts`
 * names each of those variables, and `pnpm doctor` reports them.
 *
 * Those keys used to be declared here as well. That was two validators for
 * one value, and this was the wrong one: it refused at boot over a setting
 * whose fix is on a screen served by the process being refused, and it
 * validated values the service then never read from `config`. What remains
 * is the part that cannot be a row — connection strings, secrets that open
 * rows, ports, and the crons that schedule the workers.
 */

import { loadEnv } from '@qabandi/db'
import { z } from 'zod'

loadEnv()

/**
 * An optional setting that is *absent* when blank, not empty.
 *
 * An example file carries empty keys as documentation — `DCSA_MAERSK_BASE_URL=`
 * was how `.env.example` said "there is a knob here, and you probably do not
 * need it". `z.string().optional()` reads that line as the empty string rather
 * than as unset, so a `?? default` downstream picks the empty string and wins:
 * `new URL('' + '')` throws "Invalid URL", from a deployment that had done
 * exactly what the example file told it to.
 *
 * Those particular keys have since moved to `integration_settings` rows and
 * out of the example file, but the hazard has not: a blank value can still
 * arrive from a real environment, a compose file or a hosting panel, all of
 * which set empty strings just as readily.
 *
 * Anywhere a blank line means "use the default", this is the reader to use.
 */
const blankIsUnset = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value))

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_PORT: z.coerce.number().default(3001),
  WEB_URL: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().default(10),
  PGBOSS_SCHEMA: z.string().default('pgboss'),

  INTERNAL_API_SECRET: z.string().min(1),
  /**
   * Accept `/internal` calls that arrive with forwarding headers.
   *
   * Off by default, which is what makes a misconfigured proxy fail closed
   * rather than exposing principal impersonation to the internet. Turn it on
   * only where something on the *private* network legitimately adds those
   * headers — a service mesh or a sidecar — and never to work around a public
   * route reaching this prefix.
   */
  INTERNAL_API_TRUST_PROXY: z.coerce.boolean().default(false),
  /**
   * How many proxies in front of this process append to `X-Forwarded-For` —
   * A15. The web app reads the same variable (`lib/client-address.ts`).
   *
   * Handed to Fastify's `trustProxy` as a hop count, which takes the client to
   * be that many entries from the right. `true` — what this was — takes the
   * leftmost, which is whatever the caller typed, so the rate limit keyed on
   * it could be dodged by changing a header per request.
   *
   * 1 is the shipped topology. Traefik appends the client and the web
   * container's `service-proxy.ts` forwards the header as it arrived, so from
   * here the socket is the web container and the rightmost entry is the one
   * Traefik wrote.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  /*
    Inbound mail — FR-EQ-02, the other direction.

    There is no driver switch and no mailbox list here, deliberately. Which
    mailboxes this deployment reads is `mailboxes` rows an administrator edits
    on a screen (FR-AD-03), because adding the Doha office should not be a
    release. What remains in the environment is the part that cannot be a row.

    `MAILBOX_ENCRYPTION_KEY` is that part. It opens the sealed passwords on
    those rows, and keeping it here is the whole security property: a backup, a
    restore drill or a replica of the database carries ciphertext and no key.
    A key stored beside what it protects is not encryption.

    Optional, because a deployment that receives no mail should not fail to
    boot over it — but `describeAdapters` prints the fact at start-up, and the
    settings screen refuses to save a mailbox without it. Generate one with:

      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  */
  MAILBOX_ENCRYPTION_KEY: blankIsUnset(),
  /**
   * When the poll runs. Cron, UTC.
   *
   * Every minute is the finest a cron goes, and FR-EQ-02 asks for "within one
   * minute" — so this meets the requirement at its boundary rather than
   * comfortably inside it. IMAP IDLE would make it immediate, and the port was
   * shaped so that is an adapter change.
   */
  INBOUND_MAIL_CRON: z.string().default('* * * * *'),
  /*
    `INBOUND_MAIL_BATCH` and `INBOUND_MAIL_MAX_ATTACHMENT_MB` were here and are
    now `poll_batch` and `max_attachment_mb` on the `mailboxes` row they apply
    to. They are facts about one mailbox rather than about the deployment: a
    shared Office 365 mailbox on a throttled tenant and a self-hosted Dovecot
    want different answers, and one variable for both meant tuning one of them
    down tuned all five.

    Deliberately not kept as a fallback, unlike everything else that moved.
    There is nothing to fall back *to*: the value applies per row, and a row
    already carries the old defaults as its column defaults. A deployment that
    had tuned the variable re-enters it per mailbox — see "Integration
    settings" in `README.md`.
  */

  /*
    The inbound webhooks verify the caller before anything is queued, and the
    secrets they verify against are environment rather than rows: a webhook
    arrives before any session exists, and the check has to work on a
    deployment whose settings table is empty.
  */
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  /*
    Kapso signs every `whatsapp.message.received` delivery with HMAC-SHA256 over
    the raw body, hex digest in `X-Webhook-Signature` — the same shape as the
    inbound-email webhook below, and verified by the same `verifyHmac`. The
    secret is the `secret_key` chosen when the Kapso webhook is registered, and
    it lives here rather than in a row for the reason the block above gives: the
    webhook arrives before any session exists and the check has to work on a
    deployment whose settings table is empty.

    Distinct from `WHATSAPP_APP_SECRET`, which is Meta's app secret for the
    older direct Cloud-API webhook (`X-Hub-Signature-256`, `sha256=` prefix).
    Kapso is the transport now; that path stays only for a deployment wired to
    Meta directly.
  */
  KAPSO_WEBHOOK_SECRET: z.string().optional(),
  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().optional(),

  /*
    Neither `FX_BASE_CURRENCY` nor `FX_QUOTE_CURRENCIES` exists any more.

    Both were a second answer to a question a column already answered. The
    quotes are `currencies.is_tracked`; the bases are the distinct
    `branches.base_currency` of the active entities — a branch is a legal
    entity that invoices in one currency (FR-ID-01), so that column *is* the
    list of currencies this operator needs rates into.

    The base one was not merely redundant. It was a single deployment-wide
    value defaulting to KWD, so a Dubai entity invoicing in AED had no rates
    fetched at all — silently, on a deployment whose configuration looked
    complete, and visible only by comparing a variable against a column nobody
    thought to compare it to.
  */

  /**
   * When the carrier poll runs. Cron, UTC.
   *
   * On the half hour by default so it does not land with the nightly accruals
   * or the FX refresh — a slow carrier should not look like a slow database.
   * Configurable because the right frequency is a function of the carrier's
   * rate limit, which differs per deployment and per tier. The batch size it
   * is set *with* is the `carrierPoll` integration row, where the screen can
   * check `batch × runs-per-hour` against the carrier's cap.
   */
  CARRIER_POLL_CRON: z.string().default('30 * * * *'),

  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment:\n', z.prettifyError(parsed.error))
  process.exit(1)
}

export const config = parsed.data
