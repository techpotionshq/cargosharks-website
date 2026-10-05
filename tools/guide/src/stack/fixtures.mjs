// The fixture stack: the web app on the pilot fixtures, no database, no service.
//
// This is the same mode `pnpm test:e2e` and the hosted demo run in, so every
// screen renders from `apps/web/src/lib/pilot/fixtures.ts` and nothing can be
// written. The guide adds two things: a pinned clock (see clock.mjs) so the
// data is the same on every build, and the demo sign-in, so the portal and the
// agent pages can be shown as the customer and the agent see them.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RUN, TOOL, WEB } from '../paths.mjs'
import { BRAND_KEY } from '../brand.mjs'
import { log, mkdirp, sleep } from '../util.mjs'

export const PORT = Number(process.env.GUIDE_PORT ?? 3155)
// `localhost`, not 127.0.0.1: `next dev` refuses its own chunks to any other
// host, so a page served through 127.0.0.1 renders but never hydrates.
export const BASE = `http://localhost:${PORT}`

/** The moment the fixtures believe it is. A Wednesday, inside Kuwait working hours. */
export const GUIDE_NOW = process.env.GUIDE_NOW ?? '2026-10-14T09:30:00+03:00'

const dir = () => mkdirp(join(RUN, `fixtures-${PORT}`))
const pidFile = () => join(dir(), 'pid')
const envFile = () => join(dir(), 'env.json')

async function up(url) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(4000) })
    return r.status > 0
  } catch {
    return false
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Starts the stack if it is not already running, and returns how to reach it. */
export async function start() {
  const pid = existsSync(pidFile()) ? Number(readFileSync(pidFile(), 'utf8')) : 0
  if (pid && alive(pid) && (await up(`${BASE}/track`))) {
    return { base: BASE, ...JSON.parse(readFileSync(envFile(), 'utf8')) }
  }
  const env = {
    GUIDE_NOW,
    GUIDE_EPOCH: String(Date.now()),
    // Signs the demo session cookie. Random per stack, so it is never a secret
    // anyone has to keep, and fixed for the stack's life so sessions survive
    // the dev server recompiling a route.
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  }
  // Sessions signed by the previous stack's secret are worthless now.
  rmSync(join(RUN, 'sessions'), { recursive: true, force: true })
  log(`starting the fixture stack on ${BASE} (now = ${GUIDE_NOW}, brand = ${BRAND_KEY})`)
  const out = openSync(join(dir(), 'web.log'), 'w')
  const child = spawn(
    'sh',
    ['-c', `node scripts/maplibre-worker.mjs && exec pnpm exec next dev --port ${PORT}`],
    {
      cwd: WEB,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        ...env,
        BRAND: BRAND_KEY,
        NODE_OPTIONS: `--import ${pathToFileURL(join(TOOL, 'src', 'stack', 'clock.mjs')).href}`,
        QABANDI_PILOT_FIXTURES: '1',
        QABANDI_DEMO_LOGIN: '1',
        // Cleared rather than inherited, for the reasons playwright.config.ts gives.
        DATABASE_URL: '',
        SERVICE_URL: '',
        INTERNAL_API_SECRET: '',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  )
  child.unref()
  writeFileSync(pidFile(), String(child.pid))
  writeFileSync(envFile(), JSON.stringify({ now: GUIDE_NOW }))
  for (let i = 0; i < 180; i++) {
    if (await up(`${BASE}/track`)) {
      restoreNextEnv()
      return { base: BASE, now: GUIDE_NOW }
    }
    if (!alive(child.pid)) throw new Error(`the web app exited; see ${join(dir(), 'web.log')}`)
    await sleep(1000)
  }
  throw new Error(`the web app did not answer on ${BASE}; see ${join(dir(), 'web.log')}`)
}

/**
 * `next dev` rewrites apps/web/next-env.d.ts in its own style on every start,
 * which then fails `pnpm format:check`. The committed file is the right one;
 * put it back once the server has written its copy.
 */
function restoreNextEnv() {
  const file = join(WEB, 'next-env.d.ts')
  const r = spawnSync('git', ['diff', '--quiet', '--', file], { cwd: WEB })
  if (r.status === 1) spawnSync('git', ['checkout', '--', file], { cwd: WEB })
}

/** Stops only the process group this stack started. */
export async function stop() {
  if (!existsSync(pidFile())) return
  const pid = Number(readFileSync(pidFile(), 'utf8'))
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {}
  writeFileSync(pidFile(), '')
  await sleep(1500)
  restoreNextEnv()
}
