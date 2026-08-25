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
import { extname, join, normalize } from 'node:path'
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

createServer((request, response) => {
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
    // Nothing is cached: the point of this server is to look at the file you
    // just rebuilt.
    'cache-control': 'no-store',
  })
  createReadStream(send).pipe(response)
}).listen(port, () => {
  console.log(`preview: out/ on http://127.0.0.1:${port}/  (Ctrl-C to stop)`)
})
