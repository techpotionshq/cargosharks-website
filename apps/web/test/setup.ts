/**
 * Loads the workspace `.env.local` / `.env` before a suite reads
 * `TEST_DATABASE_URL`.
 *
 * The same reason as `packages/db/test/setup.ts` and `apps/service/test/setup.ts`,
 * and this package went without it for long enough to prove the point: every
 * database-backed suite here is a `describe.skipIf(!enabled)` block gated on
 * `TEST_DATABASE_URL`, and Vitest — unlike Next — puts nothing from `.env.local`
 * into `process.env`. So on a correctly configured machine `pnpm test` reported
 * 239 passed and silently skipped 627, while CI ran all 866 because the workflow
 * exports the variable for real.
 *
 * A suite that skips looks exactly like a suite that passes, and the gap only
 * showed up on the one machine nobody checks: the developer's.
 */

import { loadEnv } from '@qabandi/db'

loadEnv()
