/**
 * Put the error pages where a static host will look for them.
 *
 * `out/404.html` is the file nginx, Caddy, Netlify, Cloudflare Pages and
 * Coolify's static buildpack all serve for an unmatched path — none of them
 * knows anything about `app/not-found.tsx`. Next writes its own built-in 404
 * there, the black-and-white one with the vertical rule, because this app has
 * no root layout for a global `not-found.tsx` to attach to (see
 * `src/app/(en)/404/page.tsx` for why it has none).
 *
 * So the 404 is an ordinary route at `/404/`, and this copies it over the
 * built-in afterwards. Three lines, run once per build, and the alternative was
 * giving up either the two-language document attributes or the 404.
 */

import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out')

/**
 * Route → the filename the host serves it under.
 *
 * `/not-found/` rather than `/404/` because Next drops a folder named `404`
 * from the route table without saying so: the build passes, the copy runs, and
 * the file copied is Next's built-in 404 onto itself. `/server-error/` for the
 * same reason and out of symmetry — nothing in a static export can produce a
 * 500 anyway, so that file exists purely for the host to serve when its own
 * upstream fails.
 */
const PAGES = [
  ['not-found', '404.html'],
  ['server-error', '500.html'],
]

/**
 * Next emits its own built-in 404 at two more paths of its own choosing —
 * `/404/` and `/_not-found/` — and leaves them in the export. Neither is linked
 * from anything, and both are reachable, so both get overwritten too. A visitor
 * who lands on one has already had one bad link; the second thing they see
 * should not be a page from a different website.
 */
const ALIASES = ['404/index.html', '_not-found/index.html']

for (const [route, filename] of PAGES) {
  const from = join(out, route, 'index.html')
  if (!existsSync(from)) {
    // Loud rather than silent: a missing source means the route was renamed and
    // that error page on the deployed site quietly went back to the default.
    console.error(`postbuild: out/${route}/index.html is missing — did the route move?`)
    process.exit(1)
  }
  copyFileSync(from, join(out, filename))
  console.log(`postbuild: out/${filename} ← out/${route}/index.html`)
}

const notFound = join(out, 'not-found', 'index.html')
for (const alias of ALIASES) {
  const target = join(out, alias)
  if (!existsSync(target)) continue
  copyFileSync(notFound, target)
  console.log(`postbuild: out/${alias} ← out/not-found/index.html`)
}

/**
 * The stand-in a blog post route builds while a language has no posts yet
 * (`NO_POSTS_SLUG` in `src/lib/blog.ts`). It is a 404 page sitting at a URL
 * that answers 200, so it goes.
 */
for (const blog of ['blog', 'ar/blog']) {
  for (const path of ['_no-posts', '_no-posts.txt']) {
    const target = join(out, blog, path)
    if (!existsSync(target)) continue
    rmSync(target, { recursive: true })
    console.log(`postbuild: removed out/${blog}/${path}`)
  }
}
