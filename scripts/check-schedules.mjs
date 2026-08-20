/**
 * Every scheduled job has a handler — Architecture §9.
 *
 * The fault this exists to prevent has now happened twice, and both times it
 * was silent for months:
 *
 *   - `fxIngest` was scheduled `0 5 * * *` from Release One with no handler.
 *     Every morning pg-boss created the job, nobody claimed it, and it aged
 *     out. FX rates simply never refreshed.
 *   - `rateCardExpiry` was scheduled `45 21 * * *` in the same commit, also
 *     with no handler. Pricing was never told a tariff was about to lapse.
 *
 * Neither produced an error, a failed job or a log line. A scheduled job with
 * no worker is not a crash — it is a queue quietly doing exactly what it was
 * asked to do, which is why review never catches it and why `PENDING` in
 * `workers/index.ts` did not help: a job can be listed as unbuilt *and*
 * scheduled at the same time, and the two lists sit in different files.
 *
 * So the rule is one sentence: **if it is on the schedule, something must be
 * registered to run it.** A job that is not built yet stays out of
 * `registerSchedules` until it is — an unscheduled gap is visible in `PENDING`
 * and costs nothing, where a scheduled one costs a nightly row and the belief
 * that the feature works.
 *
 * Text, not imports: `queue.ts` opens a database connection at module scope,
 * and a lint check that needs PostgreSQL running is a lint check people skip.
 */

import { readFileSync } from 'node:fs'

const QUEUE = 'apps/service/src/queue.ts'
const WORKERS = 'apps/service/src/workers/index.ts'

const queue = readFileSync(QUEUE, 'utf8')
const workers = readFileSync(WORKERS, 'utf8')

/** `b.schedule(JOBS.fxIngest, '0 5 * * *')` -> `fxIngest`. */
const scheduled = [...queue.matchAll(/\.schedule\(\s*JOBS\.(\w+)/g)].map((m) => m[1])

/** `await work(JOBS.fxIngest, async () => {` -> `fxIngest`. */
const handled = new Set([...workers.matchAll(/\bwork\(\s*JOBS\.(\w+)/g)].map((m) => m[1]))

/** Jobs the worker file itself declares as not built yet. */
const pending = new Set([...workers.matchAll(/name:\s*JOBS\.(\w+)/g)].map((m) => m[1]))

let failures = 0

for (const job of scheduled) {
  if (handled.has(job)) continue

  console.error(
    `${QUEUE}: JOBS.${job} is scheduled but no handler is registered in ${WORKERS}.\n` +
      (pending.has(job)
        ? '  It is listed in PENDING, which records the gap but does not close it:\n' +
          '  the job is still enqueued on its cron and discarded unclaimed.\n' +
          '  Either register a handler, or take it out of registerSchedules until\n' +
          '  it is built (§9).'
        : '  Register one with `await work(JOBS.' +
          job +
          ', ...)`, or take it out of\n  registerSchedules until it is built (§9).'),
  )
  failures++
}

/*
 * The other direction is not an error.
 *
 * `carrierEvent` and `notificationDispatch` are handled but not scheduled —
 * they are enqueued by an event, which is the normal shape for most of the
 * queue. Only "scheduled with nobody listening" is a fault.
 */

if (failures > 0) {
  console.error(`\n${failures} scheduled job(s) with no handler.`)
  process.exit(1)
}

console.log(`schedules: ${scheduled.length} scheduled jobs, all handled`)
