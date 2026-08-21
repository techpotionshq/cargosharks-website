/**
 * Environment, validated once at boot.
 *
 * A missing WhatsApp token should stop the service at start-up with a clear
 * message, not surface at 2am as a failed notification for a shipment that
 * has already sailed.
 */

import { loadEnv } from '@qabandi/db'
import { z } from 'zod'

loadEnv()

/**
 * An optional setting that is *absent* when blank, not empty.
 *
 * `.env.example` carries empty keys as documentation — `DCSA_MAERSK_BASE_URL=`
 * is how the file says "there is a knob here, and you probably do not need
 * it". `z.string().optional()` reads that line as the empty string rather than
 * as unset, so a `?? default` downstream picks the empty string and wins:
 * `new URL('' + '')` throws "Invalid URL", from a deployment that had done
 * exactly what the example file told it to.
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

  // FileStore port (§10) — Supabase Storage for the pilot, S3 for R1.
  FILE_STORE_DRIVER: z.enum(['s3', 'memory']).default('s3'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  /*
    Mail. `smtp` sends; `log` writes the message to the service log instead.

    `log` exists for a demonstration on a laptop and for the first hour of a
    deployment whose relay credentials have not arrived. It is not a silent
    failure mode: `describeAdapters` prints `email: log` at boot, so nobody has
    to work it out from an empty inbox.
  */
  MAIL_DRIVER: z.enum(['smtp', 'log']).default('smtp'),
  /** Defaults to a local MailHog/Mailpit, which is what `docker compose` runs. */
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  /** Implicit TLS from the first byte — port 465. Otherwise STARTTLS is used. */
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /**
   * Certificate verification. Set false only for a relay behind a private CA,
   * and understand that it disables the check that the server is who it says.
   */
  SMTP_TLS_REJECT_UNAUTHORIZED: z.coerce.boolean().default(true),
  MAIL_FROM: z.string().default('no-reply@qabandi.local'),

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
  /** How many messages one run takes from one mailbox. The rest wait a minute. */
  INBOUND_MAIL_BATCH: z.coerce.number().default(25),
  /**
   * Attachments larger than this are recorded by name and not stored.
   *
   * Freight mail carries packing lists and commercial invoices, and it also
   * carries the occasional 80MB scan of a whole customs file. Refusing the
   * mail over it would lose the enquiry; pulling it into memory would take the
   * worker down. So the enquiry is created either way and the oversized part
   * is noted on the message, which is the outcome a coordinator can act on.
   */
  INBOUND_MAIL_MAX_ATTACHMENT_MB: z.coerce.number().default(25),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().optional(),

  /*
    The external-service ports (§10), each defaulting to the Release One
    behaviour.

    Every one of these is `manual`/`none` unless a deployment has deliberately
    bought the thing behind it. A tracking feed is a per-container recurring
    cost and a transmission provider is a contract, so neither should switch on
    because a variable was left in an example file.
  */
  FX_SOURCE: z.enum(['manual', 'api']).default('manual'),
  /** A URL template. `{base}` and `{key}` are substituted per request. */
  FX_API_URL: z.string().optional(),
  FX_API_KEY: z.string().optional(),
  FX_BASE_CURRENCY: z.string().default('KWD'),
  /** Which currencies to keep a rate for, against the base above. */
  FX_QUOTE_CURRENCIES: z.string().default('USD,AED,EUR,GBP,SAR,QAR,BHD,OMR,INR,CNY'),

  CARRIER_TRACKING_DRIVER: z.enum(['manual', 'terminal49', 'dcsa']).default('manual'),
  CARRIER_TRACKING_API_KEY: z.string().optional(),
  CARRIER_TRACKING_BASE_URL: z.string().default('https://api.terminal49.com'),
  /** Required before the webhook will accept anything — see webhooks/index.ts. */
  CARRIER_WEBHOOK_SECRET: z.string().optional(),

  /*
    Carrier-direct over DCSA — the driver with no licence fee.

    One credential per carrier group, because that is how the carriers issue
    them: registration is self-serve and the key belongs to this deployment,
    not to us (IN-06). A carrier with no key here is simply one the poll
    worker never asks about.

    The base URL *and the events path* are overridable, because neither has
    been run against a live key from this repository. That claim was already
    made about the host and only half-honoured: the first real Maersk key
    turned out to be for the public product rather than the private one, which
    is a different path on the same host — exactly the case the sentence
    promised would be configuration, and exactly the one the code made a
    release.
  */
  DCSA_MAERSK_CONSUMER_KEY: z.string().optional(),
  /**
   * Maersk's OAuth client secret, where the granted tier issues one.
   *
   * `track-and-trace-private` wants a bearer as well as the Consumer-Key: the
   * key identifies the registered application, the bearer authorises the
   * customer whose shipments are being asked about. Set it and the adapter
   * exchanges it for a token and caches that; leave it blank and the adapter
   * sends the key alone, which is what the tiers that want only a key expect.
   */
  DCSA_MAERSK_CLIENT_SECRET: z.string().optional(),
  DCSA_MAERSK_BASE_URL: blankIsUnset(),
  DCSA_MAERSK_EVENTS_PATH: blankIsUnset(),
  DCSA_HAPAG_CLIENT_ID: z.string().optional(),
  DCSA_HAPAG_CLIENT_SECRET: z.string().optional(),
  DCSA_HAPAG_BASE_URL: blankIsUnset(),
  DCSA_HAPAG_EVENTS_PATH: blankIsUnset(),
  DCSA_CMACGM_API_KEY: z.string().optional(),
  DCSA_CMACGM_BASE_URL: blankIsUnset(),
  DCSA_CMACGM_EVENTS_PATH: blankIsUnset(),
  /**
   * How many shipments one poll run asks about.
   *
   * Fifteen, because that is what a carrier trial tier survives. These
   * gateways cap at twenty calls an hour until a commercial agreement is
   * signed, and the arithmetic a deployment has to get right is
   * `batch × runs-per-hour ≤ the carrier's cap` — so raising the frequency
   * means lowering this, and the two are set together or not at all.
   *
   * Soonest-ETA first, so a fleet larger than the cap degrades into "the
   * shipments arriving next are the ones kept current", which is the right
   * answer rather than a lucky one. The run reports what it deferred.
   */
  CARRIER_POLL_BATCH: z.coerce.number().default(15),
  /**
   * When the poll runs. Cron, UTC.
   *
   * On the half hour by default so it does not land with the nightly accruals
   * or the FX refresh — a slow carrier should not look like a slow database.
   * Configurable because the right frequency is a function of the carrier's
   * rate limit, which differs per deployment and per tier.
   */
  CARRIER_POLL_CRON: z.string().default('30 * * * *'),
  /**
   * Only poll if somebody has been signed in this recently. `0` disables it.
   *
   * Off by default, and that is the production answer: a container discharged
   * at 03:00 should be on the board at 07:00 whether or not anybody was
   * watching overnight, and the free-time clocks accrue nightly regardless.
   *
   * Set it on a trial tier, where the twenty-calls-an-hour budget is worth
   * more than overnight freshness — polling an empty office all night is how
   * a demo arrives to find its quota already spent.
   */
  CARRIER_POLL_ACTIVE_WITHIN_MINUTES: z.coerce.number().default(0),

  EINVOICE_DRIVER: z.enum(['none', 'asp']).default('none'),
  EINVOICE_ASP_URL: z.string().optional(),
  EINVOICE_ASP_API_KEY: z.string().optional(),

  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment:\n', z.prettifyError(parsed.error))
  process.exit(1)
}

export const config = parsed.data
export type Config = typeof config
