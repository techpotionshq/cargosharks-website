/**
 * Tell IndexNow (Bing, Yandex, Seznam, Naver) about posts that just went live.
 *
 *   node scripts/blog/indexnow.mjs <slug> [<slug>...]
 *   node scripts/blog/indexnow.mjs --dry <slug>
 *
 * Run by `.github/workflows/blog-indexnow.yml` after a post lands on `main`.
 * Google does not take part in IndexNow; it learns from the sitemap and Search
 * Console, which this does not replace.
 *
 * **It waits for the page to be live first.** The push to `main` and the
 * Coolify deploy race, and submitting a URL that still 404s teaches the
 * crawler the opposite of what was meant. So each URL is polled until it
 * answers 200, for up to twenty minutes, and only the live ones are sent.
 *
 * The key is the file `public/<key>.txt`, whose contents are the key itself —
 * that is how IndexNow checks the submitter owns the host.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP, CONTENT } from './lib.mjs'

const SITE = process.env.SITE_URL || 'https://cargosharks.com'
const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const slugs = args.filter((a) => !a.startsWith('--'))

const keyFile = readdirSync(join(APP, 'public')).find((f) => /^[a-f0-9]{32}\.txt$/.test(f))
if (!keyFile) throw new Error('no IndexNow key file (public/<32 hex>.txt)')
const key = keyFile.slice(0, -4)

const urls = slugs.flatMap((slug) => {
  const file = join(CONTENT, slug, 'post.json')
  if (!existsSync(file)) return [] // deleted in this push; nothing to announce
  const meta = JSON.parse(readFileSync(file, 'utf8'))
  return [meta.en && `${SITE}/blog/${slug}/`, meta.ar && `${SITE}/ar/blog/${slug}/`].filter(Boolean)
})
if (!urls.length) {
  console.log('indexnow: no live post URLs in this push')
  process.exit(0)
}
urls.push(`${SITE}/blog/`, `${SITE}/ar/blog/`)

const live = async (url) =>
  (await fetch(url, { method: 'HEAD', redirect: 'manual' }).catch(() => null))?.status === 200
const deadline = Date.now() + 20 * 60_000
let pending = [...urls]
const ready = []
while (pending.length && Date.now() < deadline && !DRY) {
  const checks = await Promise.all(pending.map(async (url) => [url, await live(url)]))
  for (const [url, ok] of checks) if (ok) ready.push(url)
  pending = checks.filter(([, ok]) => !ok).map(([url]) => url)
  if (pending.length) await new Promise((r) => setTimeout(r, 30_000))
}
if (pending.length && !DRY)
  console.warn(`indexnow: still not live after 20 minutes, skipped: ${pending.join(' ')}`)

const body = {
  host: new URL(SITE).host,
  key,
  keyLocation: `${SITE}/${keyFile}`,
  urlList: DRY ? urls : ready,
}
if (DRY || !ready.length) {
  console.log(JSON.stringify(body, null, 2))
  process.exit(0)
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
})
// 200 and 202 are both success; 202 means the key is still being verified.
if (res.status !== 200 && res.status !== 202) {
  throw new Error(`indexnow: ${res.status} ${(await res.text()).slice(0, 300)}`)
}
console.log(`indexnow: submitted ${ready.length} URLs (${res.status})`)
