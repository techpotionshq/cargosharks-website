/**
 * Migration folder invariants — Architecture §5.1, §13.
 *
 * Drizzle keeps two things in `migrations/`: the SQL that runs, and a
 * `meta/NNNN_snapshot.json` describing the schema *as of* that migration.
 * `generate` diffs the TypeScript schema against the lexically **last**
 * snapshot in `meta/` — not against the last journal entry, and not against
 * the database.
 *
 * That is the whole hazard. This repository writes policies, triggers and
 * temporal constraints by hand, and hand-written migrations added straight to
 * the journal leave no snapshot behind. The journal reached fourteen entries
 * while `meta/` still stopped at `0004`, so `generate` was silently diffing
 * against a schema nine migrations out of date: it emitted a 224-line
 * migration re-creating eight tables that already existed. On a fresh database
 * that fails at `CREATE TABLE`; on a developer's first day it looks like the
 * repository is broken, and the natural fix — hand-editing the generated file
 * down to the part they wanted — is how a wrong migration gets committed.
 *
 * The rule that prevents it: **write hand-written migrations with
 * `pnpm db:generate:custom`**, which prepares an empty SQL file *and* carries
 * the snapshot forward. Never append to `_journal.json` by hand.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'packages/db/migrations'
const META = join(DIR, 'meta')

const journal = JSON.parse(readFileSync(join(META, '_journal.json'), 'utf8'))
const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)

const snapshots = readdirSync(META)
  .filter((f) => !f.startsWith('_') && f.endsWith('_snapshot.json'))
  .sort()

let failures = 0
const fail = (message) => {
  console.error(message)
  failures++
}

// Rule 1 — every journal entry has the SQL file it names.
for (const entry of entries) {
  if (!existsSync(join(DIR, `${entry.tag}.sql`))) {
    fail(
      `${entry.tag}.sql is missing, but _journal.json entry ${entry.idx} names it.\n` +
        '  The migrator walks the journal; a missing file fails at deploy time.',
    )
  }
}

// Rule 2 — the newest migration has a snapshot, so `generate` diffs against
// the real current schema. This is the invariant that actually rotted.
const newest = entries.at(-1)
if (newest) {
  const expected = `${String(newest.idx).padStart(4, '0')}_snapshot.json`
  const last = snapshots.at(-1)
  if (last !== expected) {
    fail(
      `meta/ ends at ${last ?? '(nothing)'}, but the newest migration is ${newest.tag}.\n` +
        `  \`drizzle-kit generate\` diffs against the last snapshot, so it would\n` +
        `  re-emit every migration after ${last ?? 'the beginning'} as if it had never run.\n` +
        '  Write hand-written migrations with `pnpm db:generate:custom`, which\n' +
        '  carries the snapshot forward. Never append to _journal.json by hand.',
    )
  }
}

// Rule 3 — the snapshots that do exist form one chain. Two snapshots sharing a
// `prevId` means the folder was branched and merged, and the diff base is then
// whichever one sorts last rather than whichever one is true.
const byPrev = new Map()
for (const file of snapshots) {
  const { prevId } = JSON.parse(readFileSync(join(META, file), 'utf8'))
  if (!prevId) continue
  const siblings = byPrev.get(prevId) ?? []
  siblings.push(file)
  byPrev.set(prevId, siblings)
}
for (const [prevId, siblings] of byPrev) {
  if (siblings.length > 1) {
    fail(
      `snapshots ${siblings.join(' and ')} both follow ${prevId}.\n` +
        '  The snapshot chain has forked; the diff base is now whichever sorts last.',
    )
  }
}

if (failures > 0) {
  console.error(`\n${failures} migration invariant(s) violated.`)
  process.exit(1)
}

console.log(
  `migrations: ${entries.length} applied in order, snapshot current at ${snapshots.at(-1)}`,
)
