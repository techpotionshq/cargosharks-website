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

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_PORT: z.coerce.number().default(3001),
  WEB_URL: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().default(10),
  PGBOSS_SCHEMA: z.string().default('pgboss'),

  INTERNAL_API_SECRET: z.string().min(1),

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

  CARRIER_TRACKING_DRIVER: z.enum(['manual', 'terminal49']).default('manual'),
  CARRIER_TRACKING_API_KEY: z.string().optional(),
  CARRIER_TRACKING_BASE_URL: z.string().default('https://api.terminal49.com'),
  /** Required before the webhook will accept anything — see webhooks/index.ts. */
  CARRIER_WEBHOOK_SECRET: z.string().optional(),

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
