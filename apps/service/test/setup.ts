/**
 * Loads the workspace `.env.local` / `.env` before a suite reads
 * `TEST_DATABASE_URL`, then fills in the variables `config.ts` refuses to
 * start without.
 *
 * The same reason as `packages/db/test/setup.ts`: without it the database-
 * backed worker tests skip silently on a correctly configured machine, and a
 * suite that skips looks exactly like a suite that passes.
 *
 * ## Why the placeholders below exist
 *
 * `src/config.ts` parses `process.env` at import time and calls
 * `process.exit(1)` when the shape is wrong — correct for a service, and fatal
 * for a test run, because vitest turns that exit into a thrown error and every
 * file that transitively imports `config` fails before a single test body
 * runs. `DATABASE_URL` and `INTERNAL_API_SECRET` have no defaults, so on a
 * machine with no `.env` the whole suite died at import with
 * "process.exit unexpectedly called with 1" and a stack naming `config.ts`.
 *
 * That is exactly what CI was: a checkout with no `.env`. The suite had
 * therefore never been able to run there, and it went unnoticed because the
 * web unit tests failed earlier in the same job and the service step was
 * skipped rather than reached. Fixing the web failure is what surfaced this
 * one.
 *
 * CI now copies `.env.ci` into place before any suite runs, so
 * `INTERNAL_API_SECRET` arrives from there. `DATABASE_URL` still does not —
 * the unit job has no database on purpose — and neither is supplied on a
 * developer's machine that has never been configured. These stay as the floor
 * under both.
 *
 * These are deliberately not read from anywhere and deliberately look fake.
 * Nothing here connects: the database-backed suites gate on
 * `TEST_DATABASE_URL`, which this does *not* set, so they still skip when
 * there is no test database — a placeholder that accidentally satisfied that
 * gate would turn a skipped suite into a suite failing to connect.
 */

import { loadEnv } from '@qabandi/db'

loadEnv()

const placeholders: Record<string, string> = {
  DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/qabandi_no_such_database',
  INTERNAL_API_SECRET: 'test-only-internal-api-secret',
}

for (const [key, value] of Object.entries(placeholders)) {
  if (!process.env[key]) process.env[key] = value
}
