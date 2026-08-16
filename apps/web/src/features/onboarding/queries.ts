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

export type SetupStepKey = 'users' | 'customers' | 'rateCards' | 'enquiries' | 'jobs'

export interface SetupStep {
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

const HREF: Record<SetupStepKey, string> = {
  // Points at the administration screen rather than a dedicated user-creation
  // page, because there is not one yet: accounts are provisioned with
  // `pnpm db:create-user`. Linking to a route that 404s would be worse.
  users: '/admin',
  customers: '/customers/new',
  rateCards: '/rates',
  enquiries: '/enquiries',
  jobs: '/jobs',
}

export async function getSetupState(actor: Actor): Promise<SetupState> {
  const counts = await withActor(actor, async (tx) => {
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
