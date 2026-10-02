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

if (failures > 0) {
  console.error(`\n${failures} read(s) with no fixture branch.`)
  process.exit(1)
}

console.log(
  `fixtures: ${branched} read file(s) branched, ${writes} write path(s) exempt, ` +
    `${ALLOWED.size} allowed — every screen renders with no database`,
)
