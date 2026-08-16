/**
 * Loads the workspace `.env.local` / `.env` before the suite reads
 * `TEST_DATABASE_URL`.
 *
 * Without this the RLS tests silently skip on a correctly configured machine,
 * which is the worst possible failure mode for a suite whose whole job is to
 * prove an access control works.
 */

import { loadEnv } from '../src/env'

loadEnv()
