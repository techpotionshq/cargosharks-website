/**
 * What failed in the end-to-end run, in a form a failing job can still show.
 *
 * The seeded suite takes twelve minutes and, when it fails, says so in a log
 * whose last two hundred lines are the Postgres service container's own output,
 * printed by the runner at teardown. Playwright's own reporters do not rescue
 * that: `github` writes workflow annotations, which the checks API does not
 * return, and `html` is an artifact, which needs a download that is not always
 * reachable. So the failure list existed and could not be read without opening
 * a browser -- the same shape of problem as the coverage totals.
 *
 * This reads the JSON reporter's output and prints the failed specs, to stdout
 * and to `$GITHUB_STEP_SUMMARY` when that is set, because the summary is
 * attached to the check rather than buried in the log.
 *
 * It is deliberately a file rather than a `node -e` in the workflow: it has a
 * recursive walk and an ANSI strip in it, and neither belongs in a YAML folded
 * scalar where a stray quote is discovered by a twelve-minute CI run.
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs'

const REPORT = process.argv[2] ?? 'apps/web/playwright-report/results.json'

/**
 * Playwright colours its messages; a summary is read as text.
 *
 * Built with `fromCharCode` rather than written as a literal: the escape byte
 * is a control character either way, and `no-control-regex` refuses it in the
 * source even as `\\u001b`. Composing the pattern keeps the intent legible and
 * the file lintable, which beats an inline suppression for one character.
 */
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const plain = (s) => String(s ?? '').replace(ANSI, '')

/** Specs nest arbitrarily deep -- file suite, then describe blocks. */
function* specs(suite) {
  for (const child of suite.suites ?? []) yield* specs(child)
  for (const spec of suite.specs ?? []) yield spec
}

if (!existsSync(REPORT)) {
  console.log(`No Playwright JSON report at ${REPORT} - nothing to summarise.`)
  process.exit(0)
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'))
const lines = []

const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = report.stats ?? {}
lines.push(`${unexpected} failed, ${expected} passed, ${flaky} flaky, ${skipped} skipped`)

/*
  Top-level errors first. A webServer that never came up produces one of these
  and *no* failed specs, so a summary that only walked the tree would report an
  empty failure list on the run that failed hardest.
*/
for (const error of report.errors ?? []) {
  lines.push('', `run error: ${plain(error.message).split('\n')[0]}`)
}

const failures = []
for (const suite of report.suites ?? []) {
  for (const spec of specs(suite)) {
    if (spec.ok) continue
    for (const test of spec.tests ?? []) {
      const last = (test.results ?? []).at(-1) ?? {}
      failures.push({
        title: spec.title,
        where: `${spec.file}:${spec.line}`,
        project: test.projectName || '-',
        status: last.status ?? test.status ?? 'unknown',
        message: plain(last.error?.message).split('\n')[0].slice(0, 160),
      })
    }
  }
}

// Capped, and it says so -- a truncated list that looks complete is how the
// tail of a failure goes unlooked-at.
const CAP = 40
for (const f of failures.slice(0, CAP)) {
  lines.push('', `${f.status.toUpperCase()}  ${f.title}  [${f.project}]`, `  ${f.where}`)
  if (f.message) lines.push(`  ${f.message}`)
}
if (failures.length > CAP) {
  lines.push(
    '',
    `... and ${failures.length - CAP} more; the full report is the playwright artifact.`,
  )
}

const text = lines.join('\n')
console.log(text)

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### End-to-end failures\n\n\u0060\u0060\u0060\n${text}\n\u0060\u0060\u0060\n`,
  )
}
