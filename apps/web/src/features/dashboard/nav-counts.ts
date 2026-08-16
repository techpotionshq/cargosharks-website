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

export interface NavCounts {
  readonly openEnquiries: number
  readonly openExceptions: number
}

export const getNavCounts = cache(async (actor: Actor): Promise<NavCounts> =>
  withActor(actor, async (tx) => {
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
  }),
)
