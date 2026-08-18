/**
 * How many migrations this build expects to find applied.
 *
 * Read from Drizzle's own journal — the same file the migrator walks — so the
 * number cannot drift from the migrations that actually exist.
 *
 * It exists because a deployment answered `relation "support_grants" does not
 * exist` after a redeploy: the code was new, the database was a migration
 * behind, and nothing in the running system could say so. The symptom was a
 * `42P01` inside a query in a stack trace; the cause was one number being
 * lower than another.
 *
 * Deliberately its own module with no imports but the journal. `fleet.ts`
 * reads the filesystem and loads environment files, and the health endpoint —
 * the one route that must answer when everything else is broken — should carry
 * neither.
 */

import journal from '../migrations/meta/_journal.json' with { type: 'json' }

export const EXPECTED_MIGRATIONS: number = journal.entries.length
