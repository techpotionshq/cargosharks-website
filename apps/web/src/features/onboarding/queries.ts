/**
 * The setup checklist.
 *
 * A freight platform installed on Monday is empty, and an empty ops board is
 * indistinguishable from a broken one — every panel reads zero and nothing
 * tells the operator whether that is because the day is quiet or because
 * nobody has entered a customer yet. This answers that question.
 *
 * The steps are ordered by dependency rather than by importance: you cannot
 * raise an enquiry without a customer, and you cannot price one without a rate
 * card. Each is a cheap existence check, and they run in one transaction.
 */

import { sql } from 'drizzle-orm'
import { withActor, type Actor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotEnquiries, pilotJobs } from '@/lib/pilot/fixtures'

export type SetupStepKey = 'users' | 'customers' | 'rateCards' | 'enquiries' | 'jobs'

interface SetupStep {
  readonly key: SetupStepKey
  readonly done: boolean
  readonly count: number
  readonly href: string
}

export interface SetupState {
  readonly steps: readonly SetupStep[]
  readonly complete: boolean
  /** The first step still outstanding — what the operator should do next. */
  readonly next: SetupStep | null
  readonly doneCount: number
}

/**
 * What the pilot dataset stands for on the two steps it has no rows for.
 *
 * `pilotJobs()` and `pilotEnquiries()` carry their own counts; the desk staff
 * and the rate cards behind them are implied by the dataset rather than
 * enumerated in it. Both are above the checklist's thresholds because a
 * demonstration that opens on "you have not set this up yet" is a
 * demonstration of the wrong thing.
 */
const PILOT_INTERNAL_USERS = 6
const PILOT_RATE_CARDS = 4

const HREF: Record<SetupStepKey, string> = {
  // The users screen shows who holds what; accounts themselves are still
  // provisioned with `pnpm db:create-user`, so this is where an operator goes
  // to check the result rather than to perform the step.
  users: '/settings/users',
  customers: '/customers/new',
  rateCards: '/rates',
  enquiries: '/enquiries',
  jobs: '/jobs',
}

export async function getSetupState(actor: Actor): Promise<SetupState> {
  /*
    The pilot dataset is a *configured* system by construction — twenty jobs,
    priced enquiries, a live hold. So the checklist is complete there, and the
    counts come from the same fixtures the rest of the screen reads rather than
    from a database the pilot environment does not have.

    Without this the dashboard threw `DATABASE_URL is not set` before it
    rendered anything, which is the failure `e2e/routes.spec.ts` first caught.
    See the longer note in `features/dashboard/nav-counts.ts`.
  */
  const counts = usePilotFixtures()
    ? {
        users: PILOT_INTERNAL_USERS,
        customers: new Set(pilotJobs().map((j) => j.customerName)).size,
        rate_cards: PILOT_RATE_CARDS,
        enquiries: pilotEnquiries().length,
        jobs: pilotJobs().length,
      }
    : await withActor(actor, async (tx) => {
        // One statement rather than five. Against a database on the other side of
        // a 300ms link, five existence checks is a second and a half of staring at
        // a spinner on every page load that shows the checklist.
        const result = await tx.execute(sql`
      select
        (select count(*) from principals where type = 'internal')::int as users,
        (select count(*) from customers)::int                          as customers,
        (select count(*) from rate_cards)::int                         as rate_cards,
        (select count(*) from enquiries)::int                          as enquiries,
        (select count(*) from jobs)::int                               as jobs
    `)
        return result.rows[0] as unknown as {
          users: number
          customers: number
          rate_cards: number
          enquiries: number
          jobs: number
        }
      })

  const raw: readonly { key: SetupStepKey; count: number; needs: number }[] = [
    // One internal principal always exists — whoever is reading this. The step
    // is about there being a *team*, so it wants more than the founder.
    { key: 'users', count: counts.users, needs: 2 },
    { key: 'customers', count: counts.customers, needs: 1 },
    { key: 'rateCards', count: counts.rate_cards, needs: 1 },
    { key: 'enquiries', count: counts.enquiries, needs: 1 },
    { key: 'jobs', count: counts.jobs, needs: 1 },
  ]

  const steps = raw.map((step) => ({
    key: step.key,
    count: step.count,
    done: step.count >= step.needs,
    href: HREF[step.key],
  }))

  return {
    steps,
    complete: steps.every((step) => step.done),
    next: steps.find((step) => !step.done) ?? null,
    doneCount: steps.filter((step) => step.done).length,
  }
}
