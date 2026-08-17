/**
 * The two numbers the sidebar wears.
 *
 * A badge on every item is decoration; a badge on the two things that are
 * *wrong right now* is information. Open exceptions and unanswered enquiries
 * are the two an operations manager is accountable for, so those are the two
 * that get to interrupt.
 *
 * One statement rather than two existence checks, and memoised for the
 * request: the layout renders on every page in the group, so anything
 * expensive here is paid on every navigation.
 */

import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { withActor, type Actor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotEnquiries, pilotExceptions } from '@/lib/pilot/fixtures'

export interface NavCounts {
  readonly openEnquiries: number
  readonly openExceptions: number
}

/** Mirrors the `not in` of the statement below, so the two paths agree. */
const CLOSED_ENQUIRY_STATUSES = new Set(['won', 'lost', 'cancelled'])

export const getNavCounts = cache(async (actor: Actor): Promise<NavCounts> => {
  /*
    This guard was missing, and it took the whole ops group down with it.

    Every other query in `features/` chooses its source through this predicate.
    These two did not — they went straight to `withActor` — and because they
    are called from the `(ops)` **layout** rather than a page, the failure was
    not one broken panel. `DATABASE_URL is not set` was thrown before any
    internal screen rendered at all, which made the README's headline claim
    ("a laptop with nothing provisioned still renders every screen — including
    the day-15 rehearsal in a room with no network") false for every screen an
    operator uses.

    A layout-level query is the one place a missing fixture branch is fatal
    rather than cosmetic, which is why the sweep in `e2e/routes.spec.ts` found
    it on its first run.
  */
  if (usePilotFixtures()) {
    return {
      openEnquiries: pilotEnquiries().filter(
        (e) => !CLOSED_ENQUIRY_STATUSES.has(e.status) && e.firstRespondedAt === null,
      ).length,
      openExceptions: pilotExceptions().length,
    }
  }

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        (
          select count(*) from enquiries
           where status not in ('won', 'lost', 'cancelled')
             and first_responded_at is null
        )::int as open_enquiries,
        (select count(*) from exceptions where closed_at is null)::int as open_exceptions
    `)

    const row = result.rows[0] as unknown as
      { open_enquiries: number; open_exceptions: number } | undefined

    return {
      openEnquiries: row?.open_enquiries ?? 0,
      openExceptions: row?.open_exceptions ?? 0,
    }
  })
})
