/**
 * `pnpm doctor` — what is configured, what is not, and what that costs you.
 *
 * `.env.example` used to be ten kilobytes describing forty-four variables, and
 * a new developer reading it top to bottom could not tell which four decided
 * whether the application starts and which forty were integrations they would
 * never touch. Most of those forty are `integration_settings` rows now and the
 * file is down to the infrastructure, but the question this answers is the
 * same one: the file is documentation, and this is "am I set up yet".
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
    keys: ['MAILBOX_ENCRYPTION_KEY'],
    /*
      The key, not the mailbox list — the list is rows an administrator edits.

      Without the key a mailbox cannot be saved on the settings screen and an
      already-saved one cannot be opened by the poll, so this single variable
      is the difference between an intake that works and one that silently
      collects nothing.
    */
    without:
      'mailboxes cannot be connected or read, so emailed enquiries never reach ' +
      'the queue and every lead is typed in by hand (FR-EQ-02)',
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
    ],
    /*
      One key is enough here, unlike everywhere else on this list.

      Carrier-direct tracking is per carrier: a deployment registered with
      Maersk alone has a working feed for Maersk shipments and nothing for
      Hapag-Lloyd, which is a real and useful state rather than a half-built
      one. Reporting it as missing until all three were set would tell an
      operator to go and register for something they do not need.
    */
    any: true,
    without: 'carrier milestones are entered by an operator rather than ingested',
  },
  {
    name: 'E-invoice transmission',
    /*
      `EINVOICE_ASP_API_KEY`, which is what `config.ts` declares.

      This read `EINVOICE_API_KEY` — a variable that exists nowhere else in the
      repository — so the doctor reported transmission as unconfigured on a
      deployment that had configured it, and reported it that way for ever
      because no amount of correct configuration could set a key nothing names.
      Exactly the class of drift a flat list of strings invites, which is why
      the integration keys below are read from the catalogue instead.
    */
    keys: ['EINVOICE_ASP_API_KEY'],
    without: 'invoices render but are not transmitted to the tax authority',
  },
  {
    name: 'WhatsApp',
    keys: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
    without: 'customer notifications fall back to email only',
  },
  {
    /*
      One key, because the key is the switch.

      The model has a default and the endpoint is a constant, so a deployment
      holding a key is a deployment that can read documents. Reporting on the
      model as well would report a configured capability as missing whenever
      somebody was happy with the default.
    */
    name: 'Document and email extraction',
    keys: ['OPENROUTER_API_KEY'],
    without:
      'no document or email is read by a model: cargo facts, supplier invoice lines and rate sheets are all typed in by hand',
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

/*
  The variables below are no longer the only place these can be set.

  Most of what this section reports moved to `integration_settings` rows an
  administrator edits at Settings › Integrations (FR-AD-03), and a row wins
  over the variable it replaces. This script deliberately opens no database —
  "a doctor that needs the patient healthy to give a diagnosis is not much
  use" — so it cannot know which of them a deployment has already moved.

  Saying so is the difference between a report that is incomplete and one that
  is wrong. Without this line an operator reads `-- Container tracking` on a
  deployment whose Maersk key is configured perfectly well, and goes looking
  for a variable to set that the interface has already replaced.
*/
console.log('')

/*
  Named from the message catalogue rather than typed out here.

  Typing the list out is how this file already went wrong once — it checked
  `EINVOICE_API_KEY`, a variable that exists nowhere, and reported e-invoice
  transmission as unconfigured for ever. `INTEGRATIONS` in `@qabandi/core` is
  the real authority, and this script cannot import TypeScript; but
  `integrations.keys` in the English catalogue has one entry per integration
  and `check-messages.mjs` fails the build when the two disagree. So it is the
  same list, reachable from a plain `JSON.parse`, and an integration added
  later appears here without anybody remembering to add it.
*/
let integrationNames = []
try {
  const catalogue = JSON.parse(readFileSync('apps/web/messages/en.json', 'utf8'))
  integrationNames = Object.values(catalogue.integrations?.keys ?? {})
} catch {
  // A missing or unreadable catalogue is not worth failing the doctor over —
  // the note below simply becomes a little less specific.
}

console.log(
  integrationNames.length > 0
    ? `  Note: ${integrationNames.length} integrations — ${integrationNames.join(', ')} —`
    : '  Note: the integrations above',
)
console.log(
  '        can also be configured at Settings › Integrations, and a saved value wins',
)
console.log(
  '        over the variable above. This script reads no database, so a capability',
)
console.log('        marked missing here may already be configured there.')

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
