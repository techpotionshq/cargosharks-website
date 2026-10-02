/**
 * Every read has a fixture branch — the invariant behind `QABANDI_PILOT_FIXTURES`.
 *
 * The product renders with no database because each read tests
 * `usePilotFixtures()` before it reaches `withActor`. That is a convention, and
 * a convention held by ninety-odd call sites decays in one predictable way:
 * somebody writes a read where it is *used* rather than in the slice's
 * `queries.ts`, and it silently drops out of fixture mode.
 *
 * It decayed exactly that way. Four reads — two option loaders in
 * `ledger/ui/dialogs.tsx`, one in `operations/ui/dialogs.tsx`, and the register
 * in `ledger/unbilled.ts` — took `/quotes`, `/payments`, `/exceptions`,
 * `/finance` and the job file down with no database, while every register query
 * behind those screens had a branch all along. `NEEDS_DATABASE` in the e2e
 * harness then blamed the registers, twenty-nine route checks were skipped on
 * that diagnosis, and nothing in the pipeline could tell it was wrong.
 *
 * So the rule is mechanical rather than remembered: a file that reads through
 * `withActor` must also name `usePilotFixtures`, unless it is a write path or
 * it is listed below with a reason.
 *
 * Deliberately a small script against an explicit list, like its siblings: it
 * has no toolchain to keep current and it runs before the tests.
 */

import { globSync, readFileSync } from 'node:fs'

/**
 * Write paths are exempt: nothing in fixture mode writes.
 *
 * Detected by the `'use server'` directive rather than by filename. A file is a
 * server action because it says so, and `ledger/pricing.ts` is an action that
 * no naming convention would have caught.
 */
const USE_SERVER = /^\s*['"]use server['"]/m

/**
 * Reads that legitimately go to the database in fixture mode, each with the
 * reason it is not a gap.
 *
 * Short by design. Adding to it is a claim that a screen is *correct* to need a
 * database offline, and every entry here has been checked against a running
 * server with `DATABASE_URL` unset.
 */
const ALLOWED = new Map([
  [
    'apps/web/src/app/api/assets/[id]/route.ts',
    'streams a stored object. Fixture mode has no object store, and a download route ' +
      'that answered with an invented file would be worse than one that 404s.',
  ],
  [
    'apps/web/src/app/api/documents/[id]/route.ts',
    'the same: a document download needs a document.',
  ],
])

const files = globSync('apps/web/src/**/*.{ts,tsx}')
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => !/\.test\.tsx?$/.test(file))
  .filter((file) => !file.startsWith('apps/web/src/lib/pilot/'))
  .filter((file) => !file.startsWith('apps/web/src/lib/testing/'))

let failures = 0
let branched = 0
let writes = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')

  if (!/\bwithActor\s*\(/.test(source)) continue
  if (USE_SERVER.test(source)) {
    writes++
    continue
  }
  if (ALLOWED.has(file)) continue
  if (source.includes('usePilotFixtures')) {
    branched++
    continue
  }

  console.error(
    `${file}: reads through withActor with no usePilotFixtures() branch.\n` +
      '  Every read needs one, or the screen it serves answers 500 with no database\n' +
      '  and QABANDI_PILOT_FIXTURES stops meaning what the README says it means.\n' +
      "  Put the read in the slice's queries.ts, give it a fixture in\n" +
      '  lib/pilot/fixtures.ts, or add it to ALLOWED in this file with a reason.',
  )
  failures++
}

/*
  The other half of the same invariant.

  A fixture branch that returns a *finished* view where the query returns rows
  puts the formatting in two places, which is how two modes come to disagree
  about something neither of them computes wrongly. Nothing enforces that
  automatically — it is a review point, noted here because this is the file
  somebody reads when they add a branch.
*/

/*
  Writes have their own half of the rule.

  Exempting write paths above was right about *reads* and wrong about the
  visitor: fixture mode has nothing to write into, and an action that reached
  `withActor` threw "DATABASE_URL is not set", so every create dialog on the
  demo answered a filled-in form with an error page. Twenty-five modules did.

  So every exported function in a `'use server'` file must say what it does in
  fixture mode — `demoReadOnly()` (lib/pilot/read-only.ts) for a form, or its
  own `usePilotFixtures()` branch — before the closing brace of its body.
  Per function rather than per file, because the regression is always one new
  action added beside guarded ones.
*/
const WRITE_EXEMPT = new Map([
  [
    'apps/web/src/lib/preferences.ts#setLocalePreference',
    'writes a cookie and nothing else, which works in every mode.',
  ],
  ['apps/web/src/lib/preferences.ts#setThemePreference', 'the same: a cookie.'],
  [
    'apps/web/src/features/notifications/actions.ts#openNotification',
    'delegates to markRead in queries.ts, which branches on fixtures itself.',
  ],
  [
    'apps/web/src/features/notifications/actions.ts#clearNotifications',
    'the same, through markAllRead.',
  ],
])

let unguarded = 0
let actions = 0
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  if (!USE_SERVER.test(source)) continue

  for (const match of source.matchAll(/^export async function (\w+)/gm)) {
    const end = source.indexOf('\n}\n', match.index)
    const body = source.slice(match.index, end === -1 ? undefined : end)
    actions++
    if (/\b(?:demoReadOnly|demoReadOnlyMessage|usePilotFixtures|useDemoLogin)\s*\(/.test(body))
      continue
    if (WRITE_EXEMPT.has(`${file}#${match[1]}`)) continue

    console.error(
      `${file}: server action ${match[1]}() has no fixture-mode answer.\n` +
        '  In fixture mode it reaches the database that is not there and the form\n' +
        '  becomes an error page. Return `await demoReadOnly(form)` when it is set\n' +
        '  (lib/pilot/read-only.ts), branch on usePilotFixtures(), or add it to\n' +
        '  WRITE_EXEMPT in this file with a reason.',
    )
    unguarded++
  }
}

if (failures > 0 || unguarded > 0) {
  if (failures > 0) console.error(`\n${failures} read(s) with no fixture branch.`)
  if (unguarded > 0) console.error(`\n${unguarded} server action(s) with no fixture answer.`)
  process.exit(1)
}

console.log(
  `fixtures: ${branched} read file(s) branched, ${writes} write path(s) exempt, ` +
    `${ALLOWED.size} allowed, ${actions} action(s) answer in fixture mode — every screen renders with no database`,
)
