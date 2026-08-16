/**
 * Dead-link check.
 *
 * Cross-checks every literal internal `href` in the app against the routes
 * that actually exist. Three registers linked at detail pages that had never
 * been built, and the customer-facing tracking page offered a download route
 * that was a 404 — none of which typechecking or the build can see, because a
 * string is a valid string whether or not anything answers it.
 *
 * Template hrefs (`/jobs/${id}`) are probed with a placeholder segment, so a
 * dynamic route either exists for that prefix or it does not.
 */
import { globSync, readFileSync } from 'node:fs'

const routes = new Set(
  globSync('apps/web/src/app/**/page.tsx').map((f) =>
    f.replace('apps/web/src/app', '').replace('/page.tsx', '').replace(/\/\([a-z]+\)/g, '') || '/',
  ),
)
const dynamic = [...routes].filter((r) => r.includes('['))
const matches = (href) =>
  routes.has(href) ||
  dynamic.some((r) => new RegExp('^' + r.replace(/\[[^\]]+\]/g, '[^/]+') + '$').test(href))

const seen = new Map()
for (const file of globSync('apps/web/src/**/*.tsx')) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/href=\{?["'`](\/[^"'`?{}\s]*)/g)) {
    const href = m[1].replace(/\/$/, '') || '/'
    if (!seen.has(href)) seen.set(href, file)
  }
  for (const m of src.matchAll(/href=\{`(\/[a-z-]+)\/\$\{/g)) {
    const probe = `${m[1]}/x`
    if (!seen.has(probe)) seen.set(probe, file)
  }
}

let bad = 0
for (const [href, file] of [...seen].sort()) {
  if (!matches(href)) {
    console.log(`  DEAD  ${href.padEnd(28)} ${file}`)
    bad++
  }
}
console.log(bad ? `\n${bad} dead internal link(s).` : `\nall ${seen.size} internal links resolve.`)
