'use server'

/**
 * Pricing an enquiry off a rate card — FR-EQ-05, FR-RT-01…06.
 *
 * The engine — finding the covering card, calculating every line against the
 * consignment, applying the house margin, freezing the snapshot and numbering
 * the quotation — lives in `priceEnquiryToQuote` (`@qabandi/db`), shared with the
 * service's auto-draft sweep so a quote comes out identical whether a coordinator
 * clicked "Price it" or the machine drafted it. This is the thin half a click
 * needs: the permission, and turning a refusal into a sentence.
 */

import { revalidatePath } from 'next/cache'
import { priceEnquiryToQuote, withActor, type PricingRefusal } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { failWith, succeed, type ActionState } from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Price an enquiry and write the quotation it produces.
 *
 * Returns a message rather than throwing when there is no cover: "no rate card
 * covers this lane" is an answer a coordinator acts on by raising an RFQ, not a
 * fault. Branch scoping is RLS's: an enquiry outside the actor's branches is
 * invisible and comes back `not_found`, which is also the right answer to give.
 */
export async function priceEnquiry(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'quote.send')

  const enquiryId = read(form, 'enquiryId')
  if (!enquiryId) return failWith('Nothing to price.')

  const outcome = await withActor(session.actor, (tx) =>
    priceEnquiryToQuote(tx, enquiryId, session.principal.id, {
      // Re-pricing supersedes a quotation the customer may be holding — a
      // revision, and a different right from raising the first one.
      assertRevise: () => assertCan(session, 'quote.revise'),
    }),
  )

  if ('error' in outcome) return failWith(REFUSALS[outcome.error])

  revalidatePath('/quotes')
  revalidatePath(`/enquiries/${enquiryId}`)
  revalidatePath('/dashboard')
  return succeed(outcome.reference)
}

const REFUSALS: Record<PricingRefusal, string> = {
  not_found: 'No such enquiry, or it is not one you can see.',
  no_mode: 'The enquiry has no transport mode, so there is nothing to price it against.',
  no_cover:
    'No rate card covers this lane and mode on the readiness date. Ask an agent for a rate, or load the card.',
  no_margin:
    'Only a buying rate covers this lane, and this customer has no house margin set. Add one on their account, or load a selling card.',
  cannot_price:
    'The card needs a figure this enquiry does not carry — a container count, or a currency with no rate to the base.',
}
