/**
 * `pnpm doctor` — what is configured, what is not, and what that costs you.
 *
 * `.env.example` is ten kilobytes describing forty-four variables, and a new
 * developer reading it top to bottom cannot tell which four decide whether the
 * application starts and which forty are integrations they will never touch.
 * The file is documentation; this is the answer to "am I set up yet".
 *
 * The distinction it draws is the one that matters and that a flat list cannot:
 *
 *   required     nothing runs without it
 *   optional     a named capability degrades, and the product still works
 *
 * Almost everything here is optional by design (§10): every external service
 * sits behind a port with a stub, so an unconfigured adapter disables one
 * feature rather than breaking the application. Saying so explicitly is what
 * stops someone hunting for a WhatsApp token before they can see a job list.
 *
 * Read-only. It opens no network connection and touches no database — it
 * reports on configuration, and a doctor that needs the patient healthy to
 * give a diagnosis is not much use.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// --- environment, loaded the way the applications load it ------------------

/**
 * `.env.local` beats `.env`, and the real environment beats both — the Next
 * convention that `packages/db/src/env.ts` follows, repeated here rather than
 * imported because this script must run before anything is installed or built.
 */
function loadEnv() {
  const env = { ...process.env }
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key] !== undefined) continue // the real environment wins
      env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '')
    }
  }
  return env
}

const env = loadEnv()

const PLACEHOLDER = /replace-me|change-?me|your-|xxx|<.*>/i
const isSet = (key) => {
  const value = env[key]
  return Boolean(value && value.length > 0 && !PLACEHOLDER.test(value))
}
const allSet = (keys) => keys.every(isSet)
const anySet = (keys) => keys.some(isSet)

// --- what the product needs, and what each thing buys ----------------------

const fixtures = env.QABANDI_PILOT_FIXTURES === '1'

/**
 * Two ways to run, and both are legitimate — the day-15 rehearsal runs on
 * fixtures in production mode. So "required" depends on which one you chose,
 * and the doctor has to ask before it can answer.
 */
const required = fixtures
  ? []
  : [
      {
        name: 'DATABASE_URL',
        keys: ['DATABASE_URL'],
        why: 'the application connects as app_user, which holds no ownership (§5.1)',
      },
      {
        name: 'MIGRATION_DATABASE_URL',
        keys: ['MIGRATION_DATABASE_URL'],
        why: 'migrations run as app_migrator, never as the application role (§5.1)',
      },
    ]

const capabilities = [
  {
    name: 'Object storage',
    keys: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
    without: 'document upload and download are unavailable; PDFs render but cannot be stored',
  },
  {
    name: 'Outbound mail',
    keys: ['SMTP_HOST', 'MAIL_FROM'],
    without: 'no notification email leaves the outbox, and password reset cannot be delivered',
  },
  {
    name: 'Inbound mail',
    keys: ['INBOUND_MAILBOXES'],
    without: 'emailed enquiries never reach the queue; every lead is typed in by hand (FR-EQ-02)',
  },
  {
    name: 'FX rates',
    keys: ['FX_API_URL'],
    without: 'foreign-currency charge lines need a rate entered by hand',
  },
  {
    name: 'Container tracking',
    keys: [
      'DCSA_MAERSK_CONSUMER_KEY',
      'DCSA_HAPAG_CLIENT_ID',
      'DCSA_CMACGM_API_KEY',
      'CARRIER_TRACKING_API_KEY',
    ],
    /*
      One key is enough here, unlike everywhere else on this list.

      Carrier-direct tracking is per carrier: a deployment registered with
      Maersk alone has a working feed for Maersk shipments and nothing for
      Hapag-Lloyd, which is a real and useful state rather than a half-built
      one. Reporting it as missing until all four were set would tell an
      operator to go and buy something they already have.
    */
    any: true,
    without: 'carrier milestones are entered by an operator rather than ingested',
  },
  {
    name: 'E-invoice transmission',
    keys: ['EINVOICE_API_KEY'],
    without: 'invoices render but are not transmitted to the tax authority',
  },
  {
    name: 'WhatsApp',
    keys: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
    without: 'customer notifications fall back to email only',
  },
  {
    name: 'Telemetry',
    keys: ['OTEL_EXPORTER_OTLP_ENDPOINT'],
    without: 'traces are no-ops; errors still reach stderr',
  },
]

// --- report ----------------------------------------------------------------

const tick = '  ok  '
const cross = ' MISS '
const dash = '  --  '

let blocking = 0

console.log('')
console.log('Qabandi — configuration')
console.log('')

const [major] = process.versions.node.split('.').map(Number)
console.log(
  `${major >= 22 ? tick : cross} node ${process.versions.node}${major >= 22 ? '' : '  (>=22 required — package.json engines)'}`,
)
if (major < 22) blocking++

if (!existsSync('.env') && !existsSync('.env.local')) {
  console.log(`${dash} no .env or .env.local — copy .env.example to .env to begin`)
}

console.log('')
console.log(
  fixtures
    ? 'Mode: pilot fixtures (QABANDI_PILOT_FIXTURES=1) — the interface runs with no database.'
    : 'Mode: database. Set QABANDI_PILOT_FIXTURES=1 to run the interface with no database at all.',
)
console.log('')

if (required.length > 0) {
  console.log('Required')
  for (const item of required) {
    const ok = allSet(item.keys)
    if (!ok) blocking++
    console.log(`${ok ? tick : cross} ${item.name}`)
    if (!ok) console.log(`       ${item.why}`)
  }
  console.log('')
}

console.log('Optional — each one disables a named capability, nothing more')
for (const cap of capabilities) {
  const ok = cap.any ? anySet(cap.keys) : allSet(cap.keys)
  const partial = !ok && !cap.any && anySet(cap.keys)
  console.log(`${ok ? tick : dash} ${cap.name}${partial ? '  (partially configured)' : ''}`)
  if (!ok) console.log(`       without it: ${cap.without}`)
}

// Auth secret: not required to boot in development, and refused at boot in
// production by apps/web/instrumentation.ts. Worth reporting either way,
// because the failure it prevents — a session minted against one deployment
// being accepted by every other — is silent until it is a breach.
console.log('')
console.log('Auth')
if (isSet('BETTER_AUTH_SECRET')) {
  console.log(`${tick} BETTER_AUTH_SECRET`)
} else {
  console.log(`${dash} BETTER_AUTH_SECRET is unset or still a placeholder`)
  console.log('       fine in development; production refuses to start without it')
  console.log('       generate one per tenant:  openssl rand -base64 32')
}

// Migration expectations, read from the journal rather than a database.
const journalPath = join('packages', 'db', 'migrations', 'meta', '_journal.json')
if (existsSync(journalPath)) {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  console.log('')
  console.log(
    `Migrations: this build expects ${journal.entries.length} applied. ` +
      'Run `pnpm db:migrate`; /api/health reports drift.',
  )
}

console.log('')
if (blocking > 0) {
  console.log(`${blocking} thing(s) block a run. Everything else is optional.`)
  process.exit(1)
}
console.log('Ready. `pnpm dev` serves web on :3000 and service on :3001.')
console.log('')
