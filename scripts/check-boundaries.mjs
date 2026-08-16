/**
 * Dependency-direction check — Architecture §4.
 *
 * Two rules that no type checker can express and that quietly degrade the
 * first time someone adds a convenient import:
 *
 *   1. `core` imports nothing. It is pure domain — no I/O, no database, no
 *      framework. That is exactly what lets FR-RT-03's worked examples run as
 *      millisecond unit tests against no infrastructure.
 *
 *   2. Slices do not import each other. Shared logic goes *down* into `core`
 *      or `db`, never sideways. Quote lines and invoice lines look similar and
 *      are different concepts; a sideways import is how that gets lost.
 *
 * Deliberately a small script rather than a lint plugin: it is twenty lines of
 * regex against an explicit list, it has no toolchain to keep current, and it
 * runs in the pipeline before the tests.
 */

import { globSync, readFileSync } from 'node:fs'

const FORBIDDEN_IN_CORE = [
  /^@qabandi\//,
  /^drizzle-orm/,
  /^next(\/|$)/,
  /^react(\/|$)/,
  /^fastify/,
  /^pg(-boss)?$/,
  /^node:/,
  /^(fs|path|crypto|http|https|os|child_process)$/,
]

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g

let failures = 0

function specifiers(file) {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1])
}

// Rule 1 — core imports nothing but itself and its decimal library.
for (const file of globSync('packages/core/src/**/*.ts')) {
  for (const spec of specifiers(file)) {
    if (FORBIDDEN_IN_CORE.some((pattern) => pattern.test(spec))) {
      console.error(
        `${file}: imports "${spec}".\n` +
          '  packages/core is pure domain: no I/O, no DB, no framework (§4).\n' +
          '  Take the value as a parameter instead.',
      )
      failures++
    }
  }
}

// Rule 2 — slices do not import each other.
for (const file of globSync('apps/web/src/features/**/*.{ts,tsx}')) {
  const slice = file.split('/')[4]
  for (const spec of specifiers(file)) {
    const cross =
      /^@\/features\/([^/]+)/.exec(spec) ?? (spec.startsWith('../../') ? [spec, spec] : null)
    if (cross && cross[1] !== slice && !spec.startsWith('@/lib')) {
      console.error(
        `${file}: imports "${spec}" from another slice.\n` +
          '  Slices do not import each other (§4). Move shared logic down into\n' +
          '  @qabandi/core or @qabandi/db.',
      )
      failures++
    }
  }
}

/**
 * Rule 3 — a correlated subquery qualifies the outer table's column.
 *
 * The bug this exists to prevent appeared six times in this codebase and is
 * invisible in review. Inside a raw `sql` template, Drizzle emits a bare
 * `"id"` for `${table.id}` when the surrounding query has no joins, and a
 * qualified `"table"."id"` when it does — so the same expression is correct in
 * one caller and wrong in another. It then fails in two ways:
 *
 *   - the subquery joins two tables that both have `id`, and PostgreSQL
 *     rejects the whole query as ambiguous; or
 *   - it joins none, `"id"` silently binds to the *inner* table's own id, and
 *     the count comes back zero. Every open-jobs count in the product read
 *     zero for exactly this reason, and it looked like real data — which is
 *     the worse of the two failures by a long way.
 *
 * Writing the correlation as explicit qualified SQL — `where jp.partner_id =
 * "partners"."id"` — is correct regardless of what the outer query looks like.
 */
const SQL_TEMPLATE = /sql(?:<[^>]*>)?`([\s\S]*?)`/g
const CORRELATION = /\b(?:where|and|on)\s+\w+\.\w+\s*=\s*\$\{(\w+)\.(\w+)\}/gi

/** `jobMilestones` -> `job_milestones`, to name the fix in the message. */
const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

for (const file of globSync('apps/web/src/**/*.ts')) {
  const source = readFileSync(file, 'utf8')
  for (const template of source.matchAll(SQL_TEMPLATE)) {
    const body = template[1]
    // Only a template that opens its own SELECT can correlate at all.
    if (!/\bselect\b/i.test(body) || !/\bfrom\b/i.test(body)) continue

    for (const match of body.matchAll(CORRELATION)) {
      console.error(
        `${file}: correlated subquery interpolates \${${match[1]}.${match[2]}}.\n` +
          '  Drizzle emits an unqualified column here when the outer query has no\n' +
          '  joins, which is either ambiguous or silently binds to the inner table.\n' +
          `  Write it as "${snake(match[1])}"."${snake(match[2])}" instead.`,
      )
      failures++
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} boundary violation(s).`)
  process.exit(1)
}

console.log('boundaries: dependency direction ok, correlated subqueries qualified')
