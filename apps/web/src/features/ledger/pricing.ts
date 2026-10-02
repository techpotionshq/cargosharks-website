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
import { getTranslations } from 'next-intl/server'
import { eq } from 'drizzle-orm'
import { enquiries, priceEnquiryToQuote, withActor, type PricingRefusal } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { failWith, succeed, type ActionState, type Translate } from '@/lib/form-state'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'

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
export const priceEnquiry = refuseForbidden(async function priceEnquiry(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'quote.send')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const enquiryId = read(form, 'enquiryId')
  if (!enquiryId) return failWith(tv('nothingToPrice'))

  const outcome = await withActor(session.actor, (tx) =>
    priceEnquiryToQuote(tx, enquiryId, session.principal.id, {
      // Re-pricing supersedes a quotation the customer may be holding — a
      // revision, and a different right from raising the first one.
      assertRevise: () => assertCan(session, 'quote.revise'),
    }),
  )

  if ('error' in outcome) {
    /*
      "Add one on their account" with no way there was half an answer (D8):
      the house margin is set in the customer's commercial terms, so the
      refusal links to them. Read under the same actor, so a customer the
      coordinator cannot see gets no link rather than a dead one.
    */
    if (outcome.error === 'no_margin') {
      const [row] = await withActor(session.actor, (tx) =>
        tx
          .select({ customerId: enquiries.customerId })
          .from(enquiries)
          .where(eq(enquiries.id, enquiryId))
          .limit(1),
      )
      if (row?.customerId) {
        return {
          message: refusal(tv, outcome.error),
          link: {
            href: `/customers/${row.customerId}#commercial-terms`,
            label: tv('openCustomerTerms'),
          },
        }
      }
    }
    return failWith(refusal(tv, outcome.error))
  }

  revalidatePath('/quotes')
  revalidatePath(`/enquiries/${enquiryId}`)
  revalidatePath('/dashboard')
  return succeed(outcome.reference)
})

/*
  A switch of literal translator calls rather than a lookup table of keys, so
  `check-messages` can see every key — it resolves static calls only. The
  `never` default keeps it exhaustive when the engine learns a new refusal.
*/
function refusal(tv: Translate, reason: PricingRefusal): string {
  switch (reason) {
    case 'not_found':
      return tv('pricingNotFound')
    case 'no_mode':
      return tv('pricingNoMode')
    case 'no_container_count':
      return tv('pricingNoContainerCount')
    case 'no_cover':
      return tv('pricingNoCover')
    case 'no_margin':
      return tv('pricingNoMargin')
    case 'cannot_price':
      return tv('pricingCannotPrice')
    case 'quote_accepted':
      return tv('quoteAlreadyAccepted')
    case 'already_quoted':
      // Only the auto-draft sweep asks for a first quotation; a click never
      // does. Worded anyway, so the switch stays exhaustive.
      return tv('pricingAlreadyQuoted')
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}
