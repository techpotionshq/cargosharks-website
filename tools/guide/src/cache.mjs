// The content-addressed store.
//
// Every expensive thing the guide makes (a screenshot, a recording, a video
// segment, a voice line) is stored under a hash of everything that went into
// it. A build asks for the hash; if the file is there it is used as it is, and
// if not it is made once. Nothing is ever invalidated by hand: change an input
// and the hash changes, so the old file is simply never asked for again.
// `pnpm guide cache prune` removes what the current sources no longer name.
import { existsSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE } from './paths.mjs'
import { mkdirp } from './util.mjs'

export const stats = {}
const bump = (kind, what) => {
  stats[kind] ??= { hit: 0, made: 0 }
  stats[kind][what]++
}

/** Path for an entry. `ext` may be '' for a directory entry. */
export const entry = (kind, key, ext = '') => join(mkdirp(join(CACHE, kind)), `${key}${ext}`)

/**
 * Returns the cached path, making it with `make(tmpPath)` first if needed.
 * `make` writes to a temporary path that is renamed into place only when it
 * finishes, so an interrupted build never leaves a half-written entry behind
 * that the next build would trust.
 */
export async function cached(kind, key, ext, make) {
  const path = entry(kind, key, ext)
  if (existsSync(path)) {
    bump(kind, 'hit')
    const now = new Date()
    try {
      utimesSync(path, now, now)
    } catch {}
    return { path, hit: true }
  }
  const tmp = `${path}.tmp-${process.pid}`
  rmSync(tmp, { recursive: true, force: true })
  await make(tmp)
  renameSync(tmp, path)
  bump(kind, 'made')
  return { path, hit: false }
}

export const has = (kind, key, ext = '') => existsSync(join(CACHE, kind, `${key}${ext}`))

/** Deletes entries of `kind` not touched since `before` (ms). Used is refreshed on every hit. */
export function prune(kind, before) {
  const dir = join(CACHE, kind)
  if (!existsSync(dir)) return 0
  let n = 0
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).mtimeMs < before) {
      rmSync(p, { recursive: true, force: true })
      n++
    }
  }
  return n
}

export function summary() {
  return Object.entries(stats)
    .map(([k, v]) => `${k}: ${v.made} made, ${v.hit} cached`)
    .join('; ')
}
