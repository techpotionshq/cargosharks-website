/**
 * Serve `out/` the way a static host will.
 *
 * `next start` cannot run an export — there is no server in the output — and
 * `next dev` is not the thing being shipped: it rewrites, it falls back, and it
 * knows about routes rather than files. Both hide the class of bug this
 * command exists to catch, which is a path that resolves in development and
 * 404s on the host.
 *
 * So: no rewrites, no SPA fallback, no directory listing. A directory gets its
 * `index.html` and nothing else, an unknown path gets `404.html` with a real
 * 404 status, and that is the whole contract a static host offers.
 *
 * Node's own http and fs, because a preview server that needed a dependency
 * would be a dependency in the deployed app's manifest.
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'out')
const port = Number(process.env.PORT ?? 4173)

if (!existsSync(root)) {
  console.error('preview: out/ does not exist — run `pnpm build` first.')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  // Without this the sitemap and the feed went out as application/octet-stream,
  // which Search Console reads as "not a sitemap".
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.avif': 'image/avif',
}

/**
 * How long a browser or Cloudflare may keep a response.
 *
 * `_next/static/` is content-hashed — a changed file is a new name — so it is
 * safe to keep for a year. Everything else, the HTML above all, must be
 * revalidated on every request, or a deploy is invisible until a cache
 * expires. `no-store` everywhere was right for looking at a fresh build on a
 * laptop and wrong for the production container, which serves this file too.
 */
function cacheControl(path) {
  if (path.startsWith('/_next/static/')) return 'public, max-age=31536000, immutable'
  if (
    path.startsWith('/pic/') ||
    path.startsWith('/cargosharks-logo/') ||
    path.startsWith('/blog/')
  )
    return /\.(webp|png|jpg|svg|ico|avif)$/.test(path) ? 'public, max-age=86400' : 'no-cache'
  return 'no-cache'
}

/**
 * Redirects a static host would be configured with, done here because this is
 * the host.
 *
 * - `/what-we-do` → `/what-we-do/`. Both used to answer 200 with the same
 *   page, which is two URLs for one document. `trailingSlash: true` makes the
 *   slashed one canonical, so the other is a 301 to it.
 * - `/privacy.html` → `/privacy/`, `/ar.html` → `/ar/`, `/index.html` → `/`.
 *   The site was hand-written HTML files before it was an export, and those
 *   addresses are still in search indexes and old emails. They 404'd.
 */
function redirectFor(path) {
  if (path === '/index.html') return '/'
  const legacy = path.match(/^\/(.+)\.html$/)
  if (legacy && !['404', '500'].includes(legacy[1])) {
    const dir = legacy[1].replace(/\/index$/, '')
    if (inside(join(root, dir)) && existsSync(join(root, dir, 'index.html'))) return `/${dir}/`
  }
  if (!path.endsWith('/') && !extname(path)) {
    const dir = join(root, path)
    if (inside(dir) && existsSync(join(dir, 'index.html'))) return `${path}/`
  }
  return null
}

/** Whether a joined path is still under `out/`, and not a sibling like `out-old/`. */
function inside(target) {
  return target === root || target.startsWith(root + sep)
}

/**
 * A decoded path this server refuses outright, before anything is joined or
 * echoed back. `..` would walk out of `out/`, or ask whether a file outside
 * it exists. A control character, a `%0a` once decoded, would end up in a
 * `Location` header, where Node throws rather than writes it; that throw used
 * to be outside every `try` and took the process, and cargosharks.com, down.
 */
function refused(path) {
  return /[\p{Cc}\\]/u.test(path) || path.split('/').includes('..')
}

/**
 * `..` is stripped before the path is joined, not after. Joining first and
 * checking the result is the ordering that lets `/../../etc/passwd` out of the
 * directory on at least one platform, and this server is run on a laptop that
 * has other things on it.
 */
function resolve(url) {
  const path = normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const target = join(root, path)
  if (!target.startsWith(root)) return null
  if (existsSync(target) && statSync(target).isDirectory()) return join(target, 'index.html')
  return target
}

function handle(request, response) {
  const [path, query] = (request.url ?? '/').split(/\?(.*)/s)
  let decoded
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // A malformed escape like `/%E0%A4%A` — not a page, and not worth a crash.
    decoded = null
  }
  if (decoded === null || refused(decoded)) {
    response.writeHead(400, { 'content-type': 'text/plain' })
    response.end('400')
    return
  }

  const target = redirectFor(decoded)
  if (target) {
    response.writeHead(301, {
      // Re-encoded: the header carries ASCII, and the path was decoded to match.
      location: encodeURI(target) + (query ? `?${query}` : ''),
      'cache-control': 'public, max-age=3600',
    })
    response.end()
    return
  }

  const file = resolve(request.url ?? '/')
  const found = file && existsSync(file) && statSync(file).isFile()
  const send = found ? file : join(root, '404.html')

  if (!found && !existsSync(send)) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('404')
    return
  }

  response.writeHead(found ? 200 : 404, {
    'content-type': TYPES[extname(send)] ?? 'application/octet-stream',
    'cache-control': found ? cacheControl(path) : 'no-cache',
  })
  createReadStream(send)
    .on('error', () => response.destroy())
    .pipe(response)
}

/**
 * One request's failure is that request's. Anything `handle` did not foresee
 * answers 500 instead of exiting: this process is the production site.
 */
createServer((request, response) => {
  try {
    handle(request, response)
  } catch (error) {
    console.error('preview:', request.url, error)
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain' })
    response.end('500')
  }
}).listen(port, () => {
  console.log(`preview: out/ on http://127.0.0.1:${port}/  (Ctrl-C to stop)`)
})
