/**
 * The three numbers the sidebar wears.
 *
 * A badge on every item is decoration; a badge on the things that are *wrong
 * right now* is information. Open exceptions and unanswered enquiries are what
 * an operations manager is accountable for; supplier bills whose lines
 * disagree with the accrual are what a margin is lost to (0014). All three are
 * things somebody has to do something about today.
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
  /** Supplier bills carrying a line outside tolerance, or matched to nothing. */
  readonly payablesToReview: number
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
      // The pilot fixtures predate payables and carry no supplier bills.
      payablesToReview: 0,
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
        (select count(*) from exceptions where closed_at is null)::int as open_exceptions,
        (
          select count(*) from supplier_invoices si
           where si.status in ('received', 'approved')
             and exists (
               select 1 from supplier_invoice_lines l
                where l.supplier_invoice_id = si.id
                  and abs(
                    l.amount * si.fx_rate
                    - coalesce((
                        select sum(cl.amount_base)
                          from supplier_invoice_matches m
                          join charge_lines cl on cl.id = m.charge_line_id
                         where m.supplier_invoice_line_id = l.id
                           and m.retracted_at is null
                      ), 0)
                  ) > 0
             )
        )::int as payables_to_review
    `)

    const row = result.rows[0] as unknown as
      { open_enquiries: number; open_exceptions: number; payables_to_review: number } | undefined

    return {
      openEnquiries: row?.open_enquiries ?? 0,
      openExceptions: row?.open_exceptions ?? 0,
      payablesToReview: row?.payables_to_review ?? 0,
    }
  })
})
