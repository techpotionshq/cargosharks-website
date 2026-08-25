#!/usr/bin/env node
/**
 * The post-edit check — wired as a `PostToolUse` hook in `.claude/settings.json`.
 *
 * One job: after a file is written, run the invariant checks that *that file*
 * can break, and say nothing at all unless one fails. The whole value is in the
 * silence. A hook that prints on success is a hook that gets read past, and
 * then the one time it prints something that matters it looks like the same
 * noise as the last forty times.
 *
 * ## Why only the cheap checks
 *
 * The seven `check-*.mjs` scripts run in 80–150ms each and need nothing but
 * the file system. Typechecking is 1–2s and the test suites talk to a shared
 * remote database, so neither belongs on a per-edit path — an agent making
 * twelve edits in a row would spend a minute waiting and would eventually
 * start two suites against `qabandi_test` at once, which is the documented way
 * to make that database fail a different test every run. Those live in
 * `pnpm q gate`, which is run deliberately.
 *
 * ## Why it exits 2
 *
 * A `PostToolUse` hook that exits 2 feeds its stderr back to the agent as
 * something to act on, without undoing the write. That is exactly right here:
 * the edit is usually correct and merely incomplete — an English string whose
 * Arabic has not been written yet, a colour literal that should be a token —
 * and the useful thing is to be told now rather than at the end of the task.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(ROOT)

const posix = (f) => f.replaceAll('\\', '/')

/**
 * Which checks a path can break.
 *
 * Deliberately a duplicate of the free tier in `q.mjs` rather than an import:
 * this file is spawned on every edit and its whole budget is a few hundred
 * milliseconds, so it does not load `q.mjs`'s indexes to answer a question
 * about one string. The two lists are small, and `q gate` is the one that has
 * to be complete.
 */
function checksFor(file) {
  const checks = new Set()
  const add = (...names) => names.forEach((n) => checks.add(n))

  if (/^packages\/core\//.test(file)) add('boundaries', 'permissions')
  if (/^packages\/db\/migrations\//.test(file)) add('migrations')
  if (/^packages\/db\/src\/schema\//.test(file)) add('boundaries', 'migrations', 'messages')
  if (/^packages\/db\/src\//.test(file)) add('boundaries')
  if (/^packages\/brand\//.test(file)) add('brand')
  if (/^apps\/web\/messages\//.test(file)) add('messages')
  if (/^apps\/web\/src\//.test(file)) add('boundaries', 'messages', 'permissions')
  if (/^apps\/web\/src\/app\//.test(file)) add('links')
  if (/^apps\/service\/src\//.test(file)) add('boundaries', 'permissions')
  if (/^apps\/service\/src\/(queue\.ts|workers\/)/.test(file)) add('schedules')
  if (/^apps\/service\/src\/pdf\//.test(file)) add('brand')
  if (/\.(tsx|css)$/.test(file)) add('brand', 'links')
  if (/^apps\/landing\//.test(file)) add('brand')

  return [...checks]
}

const SCRIPT = {
  boundaries: 'scripts/check-boundaries.mjs',
  migrations: 'scripts/check-migrations.mjs',
  messages: 'scripts/check-messages.mjs',
  links: 'scripts/check-links.mjs',
  schedules: 'scripts/check-schedules.mjs',
  permissions: 'scripts/check-permissions.mjs',
  brand: 'scripts/check-brand.mjs',
}

/** Advice that is specific to the check, printed only when it fires. */
const REMEDY = {
  messages:
    'If the Arabic half is simply not written yet, write both at once:\n' +
    '  pnpm q msg set <key> --en "English" --ar "العربية"',
  brand:
    'A colour that differs between two operators is a token in packages/brand, never a literal.',
  links: 'Add the route, or point the href at one that exists — `pnpm q where <url>` lists them.',
  boundaries:
    'core imports nothing, and slices never import each other. Shared logic goes down into core or db.',
  permissions:
    'Every permission the application enforces is declared in packages/core/src/states.ts.',
  migrations: 'Never hand-edit migrations/meta/_journal.json. Use pnpm db:generate:custom.',
  schedules: 'A scheduled job with no handler is enqueued nightly and discarded unclaimed.',
}

function run(script) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    child.on('close', (code) => done({ script, code: code ?? 1, output }))
    child.on('error', () => done({ script, code: 0, output: '' }))
  })
}

/** The hook payload arrives on stdin as one JSON object. */
async function payload() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return {}
  }
}

const event = await payload()
const edited = event?.tool_input?.file_path ?? event?.tool_input?.notebook_path

/*
  Several other repositories are open as additional working directories in this
  session. An edit in one of them is not this repository's business, and running
  these checks against it would report failures about files it does not have.
*/
if (!edited) process.exit(0)
const relativePath = posix(relative(ROOT, edited))
if (relativePath.startsWith('..') || relativePath.startsWith('/')) process.exit(0)

const checks = checksFor(relativePath)
if (!checks.length) process.exit(0)

const results = await Promise.all(checks.map((name) => run(SCRIPT[name])))
const failed = results.filter((r) => r.code !== 0)

if (!failed.length) process.exit(0)

const lines = [`${relativePath} — ${failed.length} repository invariant(s) now failing:`]
for (const result of failed) {
  const name = Object.keys(SCRIPT).find((key) => SCRIPT[key] === result.script)
  lines.push(``, `## ${name}`, result.output.trim(), ``, REMEDY[name])
}

console.error(lines.join('\n'))
process.exit(2)
