import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Runs a program and returns stdout; stderr goes to the terminal so a failure explains itself. */
export const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 1 << 28,
    ...opts,
  }).toString()

/** Like `sh`, but never throws: `{ status, stdout, stderr }`. */
export const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export const mkdirp = (d) => (mkdirSync(d, { recursive: true }), d)

/** A stable hash of any JSON-able value. Object keys are sorted, so key order never changes a hash. */
export function hash(value) {
  return createHash('sha256').update(stable(value)).digest('hex').slice(0, 24)
}

export function stable(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
    .join(',')}}`
}

const fileMemo = new Map()
/** sha256 of a file's bytes, memoised by path + mtime + size for the life of the process. */
export function fileHash(path) {
  let st
  try {
    st = statSync(path)
  } catch {
    return 'missing'
  }
  const k = `${path}:${st.mtimeMs}:${st.size}`
  if (!fileMemo.has(k))
    fileMemo.set(k, createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 24))
  return fileMemo.get(k)
}

export const duration = (file) =>
  parseFloat(
    sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]),
  )

/** 1:02.5 for a human; SRT and ASS have their own formats below. */
export const clock = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`

export function srtTime(x) {
  const ms = Math.round(x * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

export function assTime(x) {
  const cs = Math.round(x * 100)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = (cs % 6000) / 100
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

/** The house timing rule: a caption stays up for at least words / 2.6 + 0.4 seconds. */
export const captionMinimum = (text) => {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return words / 2.6 + 0.4
}

export const log = (...a) => console.log('[guide]', ...a)

/**
 * Refuses to start a server on a port something else already answers on.
 * Each worktree keeps its stack's pid under its own cache, so a stack left up
 * by another checkout is invisible to it: the new `next dev` could not bind,
 * the readiness poll got its answer from the old server, and a CargoSharks
 * build signed in to an Al-Qabandi app until the 60 s sign-in timeout.
 */
export async function refuseTakenPort(url, what) {
  // A few seconds' grace: a stack stopped a moment ago (switching between the
  // fixture and seeded stacks) can still be answering while it shuts down.
  for (let i = 0; i < 10; i++) {
    let answered = false
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
      answered = r.status > 0
    } catch {}
    if (!answered) return
    await sleep(1000)
  }
  throw new Error(
    `${what}: something already answers on ${url} that this build did not start ` +
      `(another worktree's guide stack?). Stop it first.`,
  )
}

export function timer() {
  const t0 = performance.now()
  return () => (performance.now() - t0) / 1000
}

/** `--flag value` / `--flag=value` / `--flag` parsing, enough for one CLI. */
export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }
    const [k, v] = a.slice(2).split('=')
    if (v !== undefined) out[k] = v
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
    else out[k] = true
  }
  return out
}

export const readJson = (p, fallback) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}
