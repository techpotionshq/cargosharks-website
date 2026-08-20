/**
 * Loads the workspace `.env.local` / `.env` before a suite reads
 * `TEST_DATABASE_URL`.
 *
 * The same reason as `packages/db/test/setup.ts`: without it the database-
 * backed worker tests skip silently on a correctly configured machine, and a
 * suite that skips looks exactly like a suite that passes.
 */

import { loadEnv } from '@qabandi/db'

loadEnv()
