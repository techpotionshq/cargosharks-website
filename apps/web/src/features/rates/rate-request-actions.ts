'use server'

/**
 * Requesting rates from agents, and turning the winning reply into a buy card —
 * the two writes of rate procurement, FR-RT-10.
 *
 * `requestRates` writes one `rate_requests` row per agent a coordinator picked,
 * each `sent` with its own token; the service's minute sweep mails them (web has
 * no queue). `acceptRateReply` is the accept path the extraction deliberately
 * left to a person: it folds a parsed reply's lines into a versioned buy card
 * with `groupRateCards` — the exact function the CSV importer uses — under the
 * coordinator's own actor, so the audit trail answers *who awarded this rate*.
 */

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, eq, ne } from 'drizzle-orm'
import {
  enquiries,
  promoteRateReply,
  rateRequests,
  withActor,
  type PromoteRefusal,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { failWith, succeed, type ActionState, type Translate } from '@/lib/form-state'

/** A token that survives a mail round-trip — hex, matched by `rfq-routing.ts`. */
function newToken(): string {
  return randomBytes(12).toString('hex')
}

/**
 * Send an RFQ to each picked agent.
 *
 * The rows land `sent`; the service drains and mails them. An agent already on
 * this enquiry is skipped rather than asked twice — the picker greys them out,
 * and this is the guard behind that in case two coordinators pick at once.
 */
export async function requestRates(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'rate.card.write')
  const tv = await getTranslations('ratesValidation')

  const enquiryId = String(form.get('enquiryId') ?? '').trim()
  const partnerIds = form
    .getAll('partnerId')
    .map((v) => String(v).trim())
    .filter(Boolean)

  if (!enquiryId) return failWith(tv('enquiryMissing'))
  if (partnerIds.length === 0) return failWith(tv('pickAgent'))

  const count = await withActor(session.actor, async (tx) => {
    const [enquiry] = await tx
      .select({ branchId: enquiries.branchId })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    if (!enquiry) return 0

    const existing = new Set(
      (
        await tx
          .select({ partnerId: rateRequests.partnerId })
          .from(rateRequests)
          .where(and(eq(rateRequests.enquiryId, enquiryId), ne(rateRequests.status, 'superseded')))
      ).map((r) => r.partnerId),
    )

    const fresh = partnerIds.filter((id) => !existing.has(id))
    if (fresh.length === 0) return 0

    await tx.insert(rateRequests).values(
      fresh.map((partnerId) => ({
        branchId: enquiry.branchId,
        enquiryId,
        partnerId,
        status: 'sent' as const,
        token: newToken(),
      })),
    )
    return fresh.length
  })

  revalidatePath(`/enquiries/${enquiryId}`)
  return succeed(String(count))
}

/**
 * Promote a parsed reply into a versioned buy card, and mark it accepted.
 *
 * The promotion itself — the grouping, the code resolution, the renewal clamp —
 * lives in `promoteRateReply` (`@qabandi/db`), shared with the service's
 * auto-promote sweep so a buy rate comes out identical whether a coordinator
 * awarded it or the machine did. This is the thin half a click needs: the
 * permission, and turning the result into a form state.
 */
export async function acceptRateReply(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'rate.card.write')
  const tv = await getTranslations('ratesValidation')

  const rateRequestId = String(form.get('rateRequestId') ?? '').trim()
  const enquiryId = String(form.get('enquiryId') ?? '').trim()
  if (!rateRequestId) return failWith(tv('rateRequestMissing'))

  const result = await withActor(session.actor, (tx) =>
    promoteRateReply(tx, rateRequestId, session.principal.id),
  )

  /*
    The code, not `result.message`. That sentence is English and is kept for
    the service's sweep and its logs; a coordinator reads the catalogue's.
  */
  if (!result.ok) return failWith(refusal(tv, result.reason, result.values ?? {}))

  if (enquiryId) revalidatePath(`/enquiries/${enquiryId}`)
  revalidatePath('/rates')
  return succeed(result.cardId)
}

/**
 * A promotion refusal, in the reader's language.
 *
 * The `never` default is the point: a code added to `PromoteRefusal` without a
 * sentence here fails the typecheck rather than reaching a coordinator as
 * nothing at all. An absent value prints as empty rather than as "undefined".
 */
function refusal(
  tv: Translate<'ratesValidation'>,
  reason: PromoteRefusal,
  values: Readonly<Record<string, string>>,
): string {
  switch (reason) {
    case 'request_gone':
      return tv('promoteRequestGone')
    case 'already_promoted':
      return tv('promoteAlreadyCard')
    case 'not_parsed':
      return tv('promoteNotParsed')
    case 'declined':
      return tv('promoteDeclined')
    case 'no_clean_lines':
      return tv('promoteNoCleanLines')
    case 'port_missing':
      return tv('promotePortMissing', {
        origin: values.origin ?? '',
        destination: values.destination ?? '',
      })
    case 'renewal_ends_early':
      return tv('promoteRenewalEndsEarly', {
        validTo: values.validTo ?? '',
        lapses: values.lapses ?? '',
      })
    case 'charge_missing':
      return tv('promoteChargeMissing', { charge: values.charge ?? '' })
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}
