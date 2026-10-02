/**
 * Which zone a typed time belongs to.
 *
 * A `datetime-local` value carries no zone, and the one it was typed in is the
 * branch's: an operator in Kuwait recording a discharge at 09:00 means 09:00
 * in Kuwait, whatever zone the server or the reader happens to be in. Every
 * action that turns such a value into an instant asks this first, and then
 * hands the answer to `instantFromLocal` in `core`.
 *
 * Read under the caller's own transaction, so RLS answers it as it answers the
 * write that follows — a job the actor cannot see has no zone, and the caller
 * falls back to the deployment's rather than learning anything about it.
 */

import { eq } from 'drizzle-orm'
import { DEFAULT_TIME_ZONE, resolveTimeZone } from '@qabandi/core'
import type { Tx } from './actor'
import { branches } from './schema/identity'
import { jobs } from './schema/jobs'

export async function branchTimeZone(
  tx: Tx,
  scope: { readonly branchId: string } | { readonly jobId: string },
): Promise<string> {
  const rows =
    'branchId' in scope
      ? await tx
          .select({ timeZone: branches.timeZone })
          .from(branches)
          .where(eq(branches.id, scope.branchId))
          .limit(1)
      : await tx
          .select({ timeZone: branches.timeZone })
          .from(jobs)
          .innerJoin(branches, eq(branches.id, jobs.branchId))
          .where(eq(jobs.id, scope.jobId))
          .limit(1)
  return rows[0] ? resolveTimeZone(rows[0].timeZone) : DEFAULT_TIME_ZONE
}
