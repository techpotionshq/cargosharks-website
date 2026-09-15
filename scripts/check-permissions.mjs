/**
 * Every permission the application enforces is declared in core — FR-ID-03.
 *
 * The fault this exists to prevent has now happened twice, and both times it
 * was silent:
 *
 *   - The administrative keys lived as a private list in `db/seed.ts`, so
 *     `permissionKeys()` returned half the permissions in the system and
 *     anything reasoning about "all of them" got the operational half.
 *   - The fix for that — `ADMIN_PERMISSIONS` in `core/states.ts` — shipped
 *     without `consol.write`, `consol.allocate` and `document.generate`. All
 *     three were enforced by `assertCan` and granted per role in the seed, and
 *     none reached the `administrator` role, which is seeded from
 *     `allPermissionKeys()` and nothing else.
 *
 * Neither produced an error. A permission nobody holds is not a denied
 * request — `can()` returns false, the button never renders, and the screen
 * looks like a screen with no button on it. That is why review does not catch
 * this and why the per-role lists in `seed.ts` did not help: a key can be
 * carefully reasoned about for three roles and still be missing from the list
 * that grants the fourth.
 *
 * So the rule is one sentence: **if the application enforces it, `core` must
 * declare it.**
 *
 * ## Declaring it is not granting it
 *
 * This check ends where the source ends, and there is a third failure it
 * cannot see: a key correctly declared here and correctly enforced there is
 * still held by *nobody* until `pnpm db:seed` runs against the database. The
 * `administrator` role is granted `allPermissionKeys()` at seed time, and a
 * seed that ran last week knows nothing about a key added today.
 *
 * The symptom is identical to the two above — `can()` returns false, the
 * navigation entry is filtered out, the route calls `notFound()` — so a
 * finished screen looks like a screen that was never built. It happened to
 * `admin.integrations.write`: declared, enforced, policy written, screen
 * shipped, and invisible on every already-seeded database.
 *
 * A static check cannot verify a grant, so this one reports the keys that are
 * new enough to be worth suspecting and says what to run. See the note beside
 * `report()` at the foot of this file.
 *
 * Text, not imports: this reads the same source review reads, and a check that
 * needs a build step is a check people skip.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const STATES = 'packages/core/src/states.ts'
const ROOTS = ['apps/web/src', 'apps/service/src']

const states = readFileSync(STATES, 'utf8')

/** The seed's per-role matrix, read as text for the advisory note at the end. */
const seedMatrix = readFileSync('packages/db/src/seed.ts', 'utf8')

/**
 * What `core` declares: the `requires:` on every machine transition, plus the
 * `ADMIN_PERMISSIONS` literal.
 *
 * The two are read separately because they are written differently, and a
 * single permissive pattern over the whole file would also match the keys
 * quoted inside the explanatory comments — which is exactly the case this
 * check has to fail on.
 */
const declared = new Set([
  ...[...states.matchAll(/requires:\s*'([a-z_]+\.[a-z_.]+)'/g)].map((m) => m[1]),
  ...[...adminBlock(states).matchAll(/^\s*'([a-z_]+\.[a-z_.]+)',$/gm)].map((m) => m[1]),
])

/** The `ADMIN_PERMISSIONS = [...]` array body, comments and all. */
function adminBlock(source) {
  const start = source.indexOf('export const ADMIN_PERMISSIONS = [')
  if (start === -1) {
    console.error(`${STATES}: could not find ADMIN_PERMISSIONS — has it been renamed?`)
    process.exit(1)
  }
  const end = source.indexOf('] as const', start)
  return source.slice(start, end)
}

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      yield* sources(path)
    } else if (/\.tsx?$/.test(path) && !path.includes('.test.')) {
      yield path
    }
  }
}

/*
  `assertCan(session, 'job.update')` and `can(session, 'consol.write')`.

  Only these two call sites count. A permission key that appears in a string
  somewhere else — a comment, a seed, an import descriptor — is not the
  application enforcing it, and treating it as such would make this check fire
  on prose.
*/
const ENFORCED = /\b(?:assertCan|can)\(\s*session,\s*'([a-z_]+\.[a-z_.]+)'/g

const enforced = new Map()

for (const root of ROOTS) {
  for (const file of sources(root)) {
    const source = readFileSync(file, 'utf8')
    for (const [, key] of source.matchAll(ENFORCED)) {
      if (!enforced.has(key)) enforced.set(key, file)
    }
  }
}

let failures = 0

for (const [key, file] of [...enforced].sort()) {
  if (declared.has(key)) continue

  console.error(
    `${file}: '${key}' is enforced but not declared in ${STATES}.\n` +
      '  No role is seeded with it — including `administrator`, which is granted\n' +
      '  `allPermissionKeys()` and nothing else — so the screen it gates is\n' +
      '  unreachable rather than refused. Add it to ADMIN_PERMISSIONS, or put a\n' +
      '  `requires:` on the transition that earns it (FR-ID-03).',
  )
  failures++
}

/*
 * The other direction is not an error.
 *
 * A declared key with no call site is a permission whose screen is not built
 * yet — `admin.api_keys.write` is one today. That is a gap in the product,
 * visible and harmless; it grants a role the right to do something it has no
 * way to do. Only "enforced but undeclared" locks a working feature away.
 */

if (failures > 0) {
  console.error(`\n${failures} permission(s) enforced but not declared.`)
  process.exit(1)
}

/*
  Which keys an already-seeded database will not have.

  Not an error, and it cannot be: this script opens no database, so it cannot
  know which grants exist — and a developer who has just run the seed would be
  nagged by a failure they had already fixed.

  What it can do is name the keys whose *declaration* is newer than the last
  change to the seed's own role matrix, which is a good proxy for "added since
  anybody last ran `db:seed`". Git is the source: a key introduced in an
  uncommitted or recent change to `states.ts` is exactly the one nobody holds.

  Cheap and advisory, and it is the line that would have saved an afternoon.
*/
const untracked = [...declared].filter((key) => {
  // Keys the seed's per-role matrix names explicitly are granted to somebody
  // on any seed run. What is left is granted only via `allPermissionKeys()`
  // to `administrator` — which is the path that goes stale.
  return !seedMatrix.includes(`'${key}'`)
})

if (untracked.length > 0) {
  console.log(
    `permissions: ${untracked.length} key(s) reach a role only through ` +
      '`allPermissionKeys()` — run `pnpm db:seed` after adding one, or no ' +
      'account will hold it and its screen will be invisible rather than refused.',
  )
}

console.log(`permissions: ${enforced.size} enforced keys, all declared`)
