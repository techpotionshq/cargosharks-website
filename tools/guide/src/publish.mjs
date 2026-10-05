// pnpm guide:publish [--dry-run] [--prefix guide/qabandi] [--links]
//
// Uploads the built guide (docs/guide/out) to the R2 bucket, but only the
// files whose bytes differ from what is already there. Each object is asked
// for its ETag first (an S3 ETag is the MD5 of a single-part upload), so this
// works from any machine without a local record of what was sent before.
//
// Credentials come from the environment, the same four the earlier
// deliverables script used: R2_ENDPOINT, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY and R2_BUCKET. `GUIDE_R2_ENV` may name a dotenv file
// outside the repository to read them from. They are never printed and never
// written anywhere. Requests are signed here (SigV4) rather than through an
// SDK, so the guide adds no dependency to the lockfile for one PUT.
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { OUT } from './paths.mjs'
import { BRAND_KEY } from './brand.mjs'
import { log } from './util.mjs'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.srt': 'application/x-subrip; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
}

function credentials() {
  const env = { ...process.env }
  if (process.env.GUIDE_R2_ENV) {
    for (const line of readFileSync(process.env.GUIDE_R2_ENV, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?(R2_[A-Z_]+)\s*=\s*["']?([^"'\s]+)/)
      if (m && !env[m[1]]) env[m[1]] = m[2]
    }
  }
  const need = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
  const missing = need.filter((k) => !env[k])
  if (missing.length)
    throw new Error(`publishing needs ${missing.join(', ')} in the environment (or GUIDE_R2_ENV)`)
  return {
    endpoint: env.R2_ENDPOINT.replace(/\/$/, ''),
    id: env.R2_ACCESS_KEY_ID,
    secret: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  }
}

const sha = (b) => createHash('sha256').update(b).digest('hex')
const hmac = (k, s) => createHmac('sha256', k).update(s).digest()
const enc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const encKey = (k) => k.split('/').map(enc).join('/')

function signingKey(secret, date) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), 'auto'), 's3'), 'aws4_request')
}

/** A signed request to R2 (path-style), returning the fetch Response. */
async function request(c, method, key, { body, headers = {} } = {}) {
  const url = new URL(`${c.endpoint}/${c.bucket}/${encKey(key)}`)
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
  const date = now.slice(0, 8)
  const payload = body ? sha(body) : sha('')
  const h = {
    host: url.host,
    'x-amz-content-sha256': payload,
    'x-amz-date': now,
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  }
  const names = Object.keys(h).sort()
  const canonical = [
    method,
    url.pathname,
    '',
    names.map((n) => `${n}:${String(h[n]).trim()}\n`).join(''),
    names.join(';'),
    payload,
  ].join('\n')
  const scope = `${date}/auto/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha(canonical)].join('\n')
  const sig = createHmac('sha256', signingKey(c.secret, date)).update(toSign).digest('hex')
  h.authorization = `AWS4-HMAC-SHA256 Credential=${c.id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`
  delete h.host
  return fetch(url, { method, headers: h, body })
}

/** A presigned GET link, valid for `seconds` (7 days at most). */
function presign(c, key, seconds = 604800) {
  const url = new URL(`${c.endpoint}/${c.bucket}/${encKey(key)}`)
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
  const date = now.slice(0, 8)
  const scope = `${date}/auto/s3/aws4_request`
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.id}/${scope}`,
    'X-Amz-Date': now,
    'X-Amz-Expires': String(seconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const query = Object.keys(q)
    .sort()
    .map((k) => `${enc(k)}=${enc(q[k])}`)
    .join('&')
  const canonical = [
    'GET',
    url.pathname,
    query,
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha(canonical)].join('\n')
  const sig = createHmac('sha256', signingKey(c.secret, date)).update(toSign).digest('hex')
  return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${sig}`
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    // Contact sheets are for checking a build, not for readers.
    else if (!n.includes('-frames') && !/-sheet-\d+\.jpg$/.test(n) && !n.endsWith('.tmp'))
      out.push(p)
  }
  return out
}

export async function publish({ dryRun = false, prefix, links = false } = {}) {
  const pre = (prefix ?? `guide/${BRAND_KEY}`).replace(/^\/|\/$/g, '')
  const files = walk(OUT)
  if (!files.length) throw new Error(`nothing built in ${OUT}; run pnpm guide:build first`)
  const c = credentials()
  let sent = 0
  let same = 0
  for (const f of files) {
    const key = `${pre}/${relative(OUT, f).split('\\').join('/')}`
    const body = readFileSync(f)
    const md5 = createHash('md5').update(body).digest('hex')
    const head = await request(c, 'HEAD', key)
    if (head.ok && (head.headers.get('etag') ?? '').replace(/"/g, '') === md5) {
      same++
      continue
    }
    if (dryRun) {
      log(`would upload ${key} (${(body.length / 1e6).toFixed(1)} MB)`)
      sent++
      continue
    }
    const ext = f.slice(f.lastIndexOf('.'))
    const res = await request(c, 'PUT', key, {
      body,
      headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' },
    })
    if (!res.ok)
      throw new Error(`upload of ${key} failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    sent++
    log(links ? `${key}\t${presign(c, key)}` : `uploaded ${key}`)
  }
  log(
    `${dryRun ? 'would upload' : 'uploaded'} ${sent}, unchanged ${same}, under ${c.bucket}/${pre}`,
  )
}
