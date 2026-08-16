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

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@qabandi.local'),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().optional(),

  FX_SOURCE: z.enum(['manual', 'api']).default('manual'),
  FX_API_URL: z.string().optional(),
  FX_API_KEY: z.string().optional(),
  FX_BASE_CURRENCY: z.string().default('KWD'),

  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment:\n', z.prettifyError(parsed.error))
  process.exit(1)
}

export const config = parsed.data
export type Config = typeof config
