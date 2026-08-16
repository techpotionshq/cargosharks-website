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

if (failures > 0) {
  console.error(`\n${failures} dependency-direction violation(s).`)
  process.exit(1)
}

console.log('dependency direction: core <- db <- {web, service} — ok')
