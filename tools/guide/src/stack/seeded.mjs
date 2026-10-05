// The seeded stack: PostgreSQL, the service, the web app, and local stand-ins
// for WhatsApp and the model. For shorts whose buttons have to work.
//
// Data comes from a story (docs/guide/story/index.mjs): an ordered list of
// chapters, each taking the database from one state to the next (a seeded
// instance, a WhatsApp enquiry arriving, a quotation sent, a shipment booked).
// After each chapter the database is kept as a snapshot, a PostgreSQL template
// named after a hash of everything that produced it: the previous snapshot,
// the chapter's code, the migrations and seeds. A short names the chapter it
// starts from, and is recorded on a fresh copy of that snapshot, so every take
// starts from the same rows. Change a chapter and only it and the chapters
// after it are replayed.
//
// Nothing here talks to anything outside the machine. WhatsApp sends go to
// mock-kapso.mjs, the model is fake-model.mjs, mail is logged, and the
// database is the local one named in GUIDE_SEEDED_ENV. That file (kept
// outside the repository) supplies the three connection strings, because
// `db:provision` sets each role's password from its URL and the passwords are
// the local cluster's, not the guide's:
//
//   ADMIN_DATABASE_URL=postgres://postgres:…@127.0.0.1:5432/postgres
//   MIGRATION_DATABASE_URL=postgres://app_migrator:…@127.0.0.1:5432/any
//   DATABASE_URL=postgres://app_user:…@127.0.0.1:5432/any
//
// The database name in them is ignored; the guide uses its own.
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GUIDE, REPO, RUN, TOOL, WEB, chromiumPath } from '../paths.mjs'
import { BRAND_KEY, brand } from '../brand.mjs'
import { filesFingerprint } from '../graph.mjs'
import { fileHash, hash, log, mkdirp, sleep } from '../util.mjs'

export const PORT = Number(process.env.GUIDE_SEEDED_PORT ?? 3164)
const SERVICE_PORT = PORT - 3
const KAPSO_PORT = PORT - 2
export const BASE = `http://localhost:${PORT}`
const WORK_DB = process.env.GUIDE_SEEDED_DB ?? 'qg_work'
/** A throwaway password for the story's local accounts. Not a secret: the database is local and rebuilt from the story. */
export const STORY_PASSWORD = 'Guide-Story-2026!'

const dbRequire = createRequire(join(REPO, 'packages', 'db', 'package.json'))
const dir = () => mkdirp(join(RUN, `seeded-${PORT}`))
const kapsoOut = () => join(dir(), 'kapso-out.jsonl')

// --- configuration -----------------------------------------------------------

function parseEnvFile(file) {
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'\n]*)["']?\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

let cfg
function config() {
  if (cfg) return cfg
  const file = process.env.GUIDE_SEEDED_ENV
  const env = file ? parseEnvFile(file) : process.env
  for (const k of ['ADMIN_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'DATABASE_URL'])
    if (!env[k])
      throw new Error(
        `the seeded stack needs ${k}; set GUIDE_SEEDED_ENV to a file that defines the three connection strings`,
      )
  cfg = {
    admin: env.ADMIN_DATABASE_URL,
    migration: env.MIGRATION_DATABASE_URL,
    app: env.DATABASE_URL,
  }
  return cfg
}

const withDb = (url, db) => {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

/**
 * Secrets for the local apps, made once per machine and kept in the run
 * directory. They must outlive a single run: integration credentials are
 * sealed in the database with MAILBOX_ENCRYPTION_KEY, so a snapshot is only
 * usable with the key it was sealed under. Their `id` is part of every
 * snapshot's fingerprint, so a lost file means snapshots rebuild, not fail.
 */
function secrets() {
  const file = join(RUN, 'seeded-secrets.json')
  if (!existsSync(file)) {
    mkdirp(RUN)
    const r = (n) => randomBytes(n).toString('base64')
    writeFileSync(
      file,
      JSON.stringify({
        id: randomUUID(),
        BETTER_AUTH_SECRET: r(32),
        INTERNAL_API_SECRET: r(24),
        MAILBOX_ENCRYPTION_KEY: r(32),
        KAPSO_WEBHOOK_SECRET: r(24),
        INBOUND_EMAIL_WEBHOOK_SECRET: r(24),
      }),
      { mode: 0o600 },
    )
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

function appEnv() {
  const c = config()
  const s = secrets()
  return {
    ...process.env,
    BRAND: BRAND_KEY,
    DATABASE_URL: withDb(c.app, WORK_DB),
    MIGRATION_DATABASE_URL: withDb(c.migration, WORK_DB),
    ADMIN_DATABASE_URL: withDb(c.admin, 'postgres'),
    DATABASE_SSL: 'disable',
    DATABASE_POOLED: 'false',
    QABANDI_PILOT_FIXTURES: '0',
    QABANDI_DEMO_LOGIN: '0',
    BETTER_AUTH_SECRET: s.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: BASE,
    WEB_URL: BASE,
    SERVICE_URL: `http://127.0.0.1:${SERVICE_PORT}`,
    SERVICE_PORT: String(SERVICE_PORT),
    INTERNAL_API_SECRET: s.INTERNAL_API_SECRET,
    MAILBOX_ENCRYPTION_KEY: s.MAILBOX_ENCRYPTION_KEY,
    KAPSO_WEBHOOK_SECRET: s.KAPSO_WEBHOOK_SECRET,
    INBOUND_EMAIL_WEBHOOK_SECRET: s.INBOUND_EMAIL_WEBHOOK_SECRET,
    // The fake model intercepts every call; the key only has to be present.
    OPENROUTER_API_KEY: 'guide-local-never-sent',
    ANTHROPIC_API_KEY: '',
    FILE_STORE_DRIVER: 'memory',
    MAIL_DRIVER: 'log',
    CHROMIUM_EXECUTABLE_PATH: chromiumPath() ?? '',
    NEXT_TELEMETRY_DISABLED: '1',
  }
}

// --- database ------------------------------------------------------------------

async function admin(sql, params = []) {
  const { Client } = dbRequire('pg')
  const c = new Client({ connectionString: withDb(config().admin, 'postgres') })
  await c.connect()
  try {
    return (await c.query(sql, params)).rows
  } finally {
    await c.end()
  }
}

/** A query against the working database, as the superuser (story set-up and lookups only). */
export async function sql(text, params = []) {
  const { Client } = dbRequire('pg')
  const c = new Client({ connectionString: withDb(config().admin, WORK_DB) })
  await c.connect()
  try {
    return (await c.query(text, params)).rows
  } finally {
    await c.end()
  }
}

const exists = async (db) =>
  (await admin('select 1 from pg_database where datname = $1', [db])).length > 0
const kick = (db) =>
  admin(
    'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
    [db],
  )

async function copyDb(from, to) {
  await kick(from)
  await kick(to)
  await admin(`drop database if exists "${to}"`)
  await admin(`create database "${to}" template "${from}"`)
}

/** Sets a password for an existing account, the way create-user does (Better Auth's own hash). */
export async function setPassword(email, password) {
  const { hashPassword } = await import(pathToFileURL(dbRequire.resolve('better-auth/crypto')).href)
  const [u] = await sql('select id from auth_user where email = $1', [email])
  if (!u) throw new Error(`no account for ${email}`)
  const hashed = await hashPassword(password)
  const updated = await sql(
    "update auth_account set password = $2 where user_id = $1 and provider_id = 'credential' returning id",
    [u.id, hashed],
  )
  if (!updated.length)
    await sql(
      "insert into auth_account (id, account_id, provider_id, user_id, password, created_at, updated_at) values (gen_random_uuid()::text, $1, 'credential', $1, $2, now(), now())",
      [u.id, hashed],
    )
}

// --- processes -------------------------------------------------------------------

const pidFile = (name) => join(dir(), `${name}.pid`)
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const running = (name) =>
  existsSync(pidFile(name)) && alive(Number(readFileSync(pidFile(name), 'utf8')))

function launchProcess(name, cmd, args, cwd, env) {
  const out = openSync(join(dir(), `${name}.log`), 'a')
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', out, out] })
  child.unref()
  writeFileSync(pidFile(name), String(child.pid))
}

async function kill(name) {
  if (!existsSync(pidFile(name))) return
  const pid = Number(readFileSync(pidFile(name), 'utf8'))
  if (!(pid > 1)) return rmSync(pidFile(name), { force: true })
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {}
  for (let i = 0; i < 20 && alive(pid); i++) await sleep(250)
  rmSync(pidFile(name), { force: true })
}

async function waitHttp(url, name, tries = 180) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(4000) })
      if (r.status > 0) return
    } catch {}
    if (!running(name)) throw new Error(`${name} exited; see ${join(dir(), `${name}.log`)}`)
    await sleep(1000)
  }
  throw new Error(`${name} did not answer on ${url}`)
}

async function startService() {
  if (running('service')) return
  launchProcess(
    'service',
    join(REPO, 'apps', 'service', 'node_modules', '.bin', 'tsx'),
    ['--import', pathToFileURL(join(TOOL, 'src', 'stack', 'fake-model.mjs')).href, 'src/index.ts'],
    join(REPO, 'apps', 'service'),
    { ...appEnv(), NODE_ENV: 'production' },
  )
  await waitHttp(`http://127.0.0.1:${SERVICE_PORT}/`, 'service')
}

async function startWeb() {
  if (running('web')) return
  launchProcess(
    'web',
    'sh',
    ['-c', `node scripts/maplibre-worker.mjs && exec pnpm exec next dev --port ${PORT}`],
    WEB,
    appEnv(),
  )
  await waitHttp(`${BASE}/track`, 'web')
  // next dev rewrites the committed next-env.d.ts in its own style; put it back.
  if (spawnSync('git', ['diff', '--quiet', '--', 'next-env.d.ts'], { cwd: WEB }).status === 1)
    spawnSync('git', ['checkout', '--', 'next-env.d.ts'], { cwd: WEB })
}

async function startImap() {
  if (running('imap')) return
  launchProcess('imap', process.execPath, [join(TOOL, 'src', 'stack', 'mock-imap.mjs')], dir(), {
    ...process.env,
    GUIDE_IMAP_PORT: String(PORT - 1),
  })
}

async function startKapso() {
  await startImap()
  if (running('kapso')) return
  launchProcess('kapso', process.execPath, [join(TOOL, 'src', 'stack', 'mock-kapso.mjs')], dir(), {
    ...process.env,
    GUIDE_KAPSO_PORT: String(KAPSO_PORT),
    GUIDE_KAPSO_OUT: kapsoOut(),
  })
}

async function runDbScript(script, args = []) {
  // tsx on the script itself rather than `pnpm --filter … <script> -- args`,
  // which forwards a literal `--` that create-user then reads as an argument.
  const db = join(REPO, 'packages', 'db')
  execFileSync(join(db, 'node_modules', '.bin', 'tsx'), [`src/${script}.ts`, ...args], {
    cwd: db,
    env: appEnv(),
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

// --- the story ---------------------------------------------------------------------

let storyMemo
async function story() {
  if (storyMemo) return storyMemo
  const file = join(GUIDE, 'story', 'index.mjs')
  const mod = await import(pathToFileURL(file).href)
  const chapters = mod.default
  const shortsDir = join(GUIDE, 'shorts')
  const base = hash({
    story: fileHash(file),
    migrations: filesFingerprint(
      execFileSync(
        'git',
        [
          'ls-files',
          'packages/db/migrations',
          'packages/db/src/seed.ts',
          'packages/db/src/seed-demo.ts',
        ],
        { cwd: REPO, encoding: 'utf8' },
      )
        .trim()
        .split('\n'),
    ),
    secrets: secrets().id,
    brand: BRAND_KEY,
    tool: filesFingerprint([
      'tools/guide/src/stack/seeded.mjs',
      'tools/guide/src/stack/fake-model.mjs',
    ]),
  })
  let prev = base
  const keyed = chapters.map((ch) => {
    let short = null
    if (ch.short) {
      const f = join(shortsDir, `${ch.short}.mjs`)
      short = { file: f, hash: fileHash(f) }
    }
    prev = hash({ prev, id: ch.id, short: short?.hash, code: String(ch.run ?? '') })
    return { ...ch, key: prev, shortFile: short?.file }
  })
  storyMemo = { chapters: keyed, file }
  return storyMemo
}

export const loadStory = () => story()

export function fingerprint(spec) {
  if (!storyMemo) throw new Error('seeded stack: story not loaded')
  const ch = storyMemo.chapters.find((c) => c.id === spec.snapshot)
  if (!ch) throw new Error(`${spec.id}: no story chapter "${spec.snapshot}"`)
  return `seeded@${ch.key}`
}

const snapName = (ch) => `qg_s_${ch.key.slice(0, 16)}`

/** The context a chapter or a short's helpers get. */
function storyContext(stack) {
  return {
    stack,
    sql,
    setPassword,
    password: STORY_PASSWORD,
    kapsoCount: () => {
      try {
        return readFileSync(kapsoOut(), 'utf8').trim().split('\n').filter(Boolean).length
      } catch {
        return 0
      }
    },
    sendWhatsApp: async (text, { from = '96550001234', name = 'Maryam Al-Hajri' } = {}) => {
      const id = `wamid.GUIDE${Date.now()}`
      const raw = JSON.stringify({
        message: {
          id,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          from,
          text: { body: text },
          kapso: { direction: 'inbound', status: 'received', has_media: false, content: text },
        },
        conversation: {
          id: `conv_guide_${from}`,
          contact_name: name,
          phone_number: from,
          phone_number_id: '100200300400500',
        },
        is_new_conversation: false,
        phone_number_id: '100200300400500',
      })
      const sig = createHmac('sha256', secrets().KAPSO_WEBHOOK_SECRET).update(raw).digest('hex')
      const r = await fetch(`http://127.0.0.1:${SERVICE_PORT}/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-event': 'whatsapp.message.received',
          'x-webhook-signature': sig,
          'x-idempotency-key': randomUUID(),
        },
        body: raw,
      })
      if (!r.ok) throw new Error(`whatsapp webhook answered ${r.status}`)
    },
    sendMail: async ({
      from,
      fromName,
      subject,
      text,
      mailbox = `sales@${brand.identity.key}.example`,
    }) => {
      const raw = JSON.stringify({
        messageId: `<${randomUUID()}@guide.test>`,
        mailbox,
        from,
        fromName,
        to: [mailbox],
        subject,
        text,
        receivedAt: new Date().toISOString(),
      })
      const sig = createHmac('sha256', secrets().INBOUND_EMAIL_WEBHOOK_SECRET)
        .update(raw)
        .digest('hex')
      const r = await fetch(`http://127.0.0.1:${SERVICE_PORT}/webhooks/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-signature': sig },
        body: raw,
      })
      if (!r.ok) throw new Error(`email webhook answered ${r.status}`)
    },
    waitFor: async (fn, timeout = 120000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < timeout) {
        if (await fn()) return
        await sleep(1500)
      }
      throw new Error('timed out waiting for the story')
    },
    kapsoBase: `http://127.0.0.1:${KAPSO_PORT}`,
    imapPort: PORT - 1,
    mailbox: `sales@${brand.identity.key}.example`,
    dbScript: runDbScript,
    /** A browser page signed in as `who` (null for signed out). Close it with `close()`. */
    page: async (who = 'operations') => {
      const { launch, context } = await import('../record/browser.mjs')
      const browser = await launch()
      const c = await context(browser, stack, { who, scale: 1 })
      const page = await c.newPage()
      page.setDefaultTimeout(30000)
      return { page, base: BASE, close: () => browser.close() }
    },
  }
}

const sessionsDir = () => join(RUN, 'sessions')
const clearSessions = () => rmSync(sessionsDir(), { recursive: true, force: true })

/** Makes sure the snapshot for `chapterId` exists, replaying the story up to it if needed. */
async function ensureSnapshot(stack, chapterId) {
  const { chapters } = await story()
  const i = chapters.findIndex((c) => c.id === chapterId)
  if (i < 0) throw new Error(`no story chapter "${chapterId}"`)
  const ch = chapters[i]
  if (await exists(snapName(ch))) return snapName(ch)
  if (i === 0) {
    log(`story: building "${ch.id}" from migrations and seeds`)
    await kill('service')
    await kick(WORK_DB)
    await admin(`drop database if exists "${WORK_DB}"`)
    await runDbScript('provision')
    await runDbScript('migrate')
    await runDbScript('seed')
    await runDbScript('seed-demo')
  } else {
    await ensureSnapshot(stack, chapters[i - 1].id)
    log(`story: playing "${ch.id}"`)
    await restore(chapters[i - 1])
  }
  clearSessions()
  writeFileSync(kapsoOut(), '')
  await startService()
  await startWeb()
  const ctx = storyContext(stack)
  if (ch.run) await ch.run(ctx)
  if (ch.short) {
    const { record } = await import('../record/session.mjs')
    const spec = (await import(pathToFileURL(ch.shortFile).href)).default
    const tmp = mkdirp(join(dir(), `play-${ch.id}`))
    await startWeb()
    await record(spec, { ensure: async () => stack, fingerprint: () => '' }, tmp, { ctx })
    rmSync(tmp, { recursive: true, force: true })
  }
  await sleep(1500)
  await kill('service')
  await copyDb(WORK_DB, snapName(ch))
  log(`story: "${ch.id}" kept as ${snapName(ch)}`)
  return snapName(ch)
}

async function restore(ch) {
  await kill('service')
  await copyDb(snapName(ch), WORK_DB)
  clearSessions()
}

// --- the stack interface -------------------------------------------------------------

let stackObj
export async function start() {
  if (stackObj) return stackObj
  await story()
  if (!(await exists(WORK_DB))) await admin(`create database "${WORK_DB}"`)
  await startKapso()
  stackObj = {
    id: `seeded-${PORT}`,
    base: BASE,
    now: null,
    emails: {
      operations: `sara@${brand.identity.key}.example`,
      customer: 'maryam.alhajri@rumret.test',
    },
    passwords: { operations: STORY_PASSWORD, customer: STORY_PASSWORD },
    afterSignIn: totpStep,
    /** Called before each take: a fresh copy of the spec's chapter, a running service and web app. */
    prepare: async (spec, ctx) => {
      const ch = (await story()).chapters.find((c) => c.id === spec.snapshot)
      await ensureSnapshot(stackObj, spec.snapshot)
      await restore(ch)
      writeFileSync(kapsoOut(), '')
      await startService()
      await startWeb()
      Object.assign(ctx, storyContext(stackObj))
    },
  }
  return stackObj
}

/** Administrators enrol in two-factor on first sign-in; the code is computed from the secret shown then. */
async function totpStep(page, who) {
  const secretFile = join(dir(), `totp-${who}.txt`)
  const url = () => new URL(page.url()).pathname
  // The second factor is asked for on the next page that needs a session, which
  // is not always the page the sign-in form lands on. Ask for one.
  await page.waitForLoadState('networkidle').catch(() => {})
  if (!url().startsWith('/two-factor')) {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  }
  if (url().includes('/two-factor/enrol')) {
    const pw = page.locator('form:has(input[name=password]) input[name=password]')
    if (await pw.count()) {
      await pw.fill(STORY_PASSWORD)
      await page.locator('form:has(input[name=password]) button[type=submit]').click()
    }
    await page.waitForSelector('details summary')
    await page.click('details summary')
    const secret = (await page.locator('details code').innerText()).trim()
    writeFileSync(secretFile, secret)
    await page.fill('input[name=code]', totp(secret))
    await page.click('form:has(input[name=code]) button[type=submit]')
    await page.waitForURL((u) => !u.pathname.startsWith('/two-factor'), { timeout: 30000 })
  } else if (url().includes('/two-factor')) {
    await page.fill('input[name=code]', totp(readFileSync(secretFile, 'utf8').trim()))
    await page.click('form:has(input[name=code]) button[type=submit]')
    await page.waitForURL((u) => !u.pathname.startsWith('/two-factor'), { timeout: 30000 })
  }
  await page.waitForLoadState('networkidle').catch(() => {})
}

export function totp(secret) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '').replace(/\s/g, '').toUpperCase())
    bits += a.indexOf(c).toString(2).padStart(5, '0')
  const key = []
  for (let i = 0; i + 8 <= bits.length; i += 8) key.push(parseInt(bits.slice(i, i + 8), 2))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', Buffer.from(key)).update(buf).digest()
  const o = h[h.length - 1] & 15
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0')
}

export async function stop() {
  for (const n of ['web', 'service', 'kapso', 'imap']) await kill(n)
  stackObj = undefined
}
