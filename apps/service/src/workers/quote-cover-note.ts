/**
 * Drafting a quotation's covering note — the generative surface the roadmap
 * puts after the evaluation harness.
 *
 * A coordinator on a draft quote asks for the covering paragraph; the model
 * writes prose in the customer's language and it lands on the quote for them to
 * edit. Two things make this safe rather than "an AI writing to customers":
 *
 *   - **It writes prose, never a figure.** `rating.ts` and the quotation table
 *     own every number; the prompt forbids the model from stating one, and the
 *     note is stored beside the totals, not among them.
 *   - **Nothing sends it.** The note is written onto a `draft` quote. The only
 *     path to the customer is `setQuoteStatus('sent')`, which is a human act
 *     behind `quote.send`; this surface has no route to it. Drafting is the
 *     feature; sending is not.
 *
 * Unlike the extraction surfaces this produces plain text, not field proposals —
 * a covering note is one paragraph, not a set of columns — so there is no
 * `extraction_proposals` row and no schema on the call. The `ai_invocations`
 * ledger row is the audit, cost and corpus trail, and `pnpm ai:eval` can score
 * this surface once it accumulates.
 */

import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  customers,
  enquiries,
  locations,
  quotes,
  withActor,
  type Actor,
  type Tx,
} from '@qabandi/db'
import { finaliseCoverNote } from '@qabandi/core'
import { invoke } from '../ai/ledger'
import {
  QUOTE_COVER_NOTE_PROMPT_VERSION,
  quoteCoverNoteSystemPrompt,
  quoteCoverNoteUserPrompt,
} from '../ai/prompts'

export interface DraftCoverNoteInput {
  readonly actor: Actor
  readonly branchId: string
  readonly quoteId: string
  /** The language to draft in — the customer's. */
  readonly locale: 'en' | 'ar'
}

export interface DraftCoverNoteResult {
  readonly invocationId: string | null
  /** The drafted note, or null where nothing was drafted. */
  readonly note: string | null
  readonly locale: 'en' | 'ar'
  /** Why nothing was drafted, in one line, where nothing was. */
  readonly refusal?: string
  /**
   * The same refusal as a stable code, for a caller that must say it in the
   * reader's language — `refusal` is English and stays for logs and the
   * auto-draft worker, which only ever records it.
   */
  readonly refusalCode?: CoverNoteRefusalCode
}

/** Every reason the worker itself declines to draft. */
export type CoverNoteRefusalCode = 'not_found' | 'not_draft'

/**
 * Draft one covering note and store it on the quote.
 *
 * `AiUnavailableError` from `invoke` (no model configured, or the budget spent)
 * is left to propagate — the route turns it into the "add a key" answer the
 * screen shows, exactly as the "Read a bill" path does. Everything this worker
 * itself refuses is a state a person can fix, and it says which.
 */
export async function draftQuoteCoverNote(
  input: DraftCoverNoteInput,
): Promise<DraftCoverNoteResult> {
  const facts = await loadFacts(input.actor, input.quoteId)

  if (!facts) {
    return {
      invocationId: null,
      note: null,
      locale: input.locale,
      refusal: 'No such quote, or it is outside your scope.',
      refusalCode: 'not_found',
    }
  }

  if (facts.status !== 'draft') {
    /*
      Only a draft is editable — a sent or superseded quote is history (SRS §7),
      and a note drafted onto one could never reach the customer it was written
      for. The screen gates the button on this too; this is the guard behind it.
    */
    return {
      invocationId: null,
      note: null,
      locale: input.locale,
      refusal: 'A covering note can only be drafted on a draft quote.',
      refusalCode: 'not_draft',
    }
  }

  const localised = input.locale === 'ar'
  const { response, invocationId } = await invoke(
    {
      actor: input.actor,
      branchId: input.branchId,
      surface: 'quote_cover_note',
      promptVersion: QUOTE_COVER_NOTE_PROMPT_VERSION,
      enquiryId: facts.enquiryId,
    },
    {
      surface: 'quote_cover_note',
      messages: [
        { role: 'system', content: quoteCoverNoteSystemPrompt(input.locale) },
        {
          role: 'user',
          content: quoteCoverNoteUserPrompt({
            reference: facts.reference,
            // The customer's name and lane in the language being drafted, so the
            // note reads in one voice rather than switching scripts mid-sentence.
            customerName:
              (localised ? facts.customerNameAr : facts.customerNameEn) ?? facts.customerNameEn,
            mode: facts.mode,
            origin: (localised ? facts.originAr : facts.originEn) ?? facts.originEn,
            destination:
              (localised ? facts.destinationAr : facts.destinationEn) ?? facts.destinationEn,
            incoterm: facts.incoterm,
            validUntil: facts.validUntil,
          }),
        },
      ],
    },
  )

  const note = finaliseCoverNote(response.text)

  /*
    Written under the caller's actor, and guarded on `draft` again in the
    `where`: a quote sent between the read above and this write must not have a
    note appear on it after the fact. RLS scopes it to the caller's branch.
  */
  await withActor(input.actor, (tx: Tx) =>
    tx
      .update(quotes)
      .set(localised ? { coverNoteAr: note } : { coverNoteEn: note })
      .where(and(eq(quotes.id, input.quoteId), eq(quotes.status, 'draft'))),
  )

  return { invocationId, note, locale: input.locale }
}

interface CoverNoteFacts {
  readonly reference: string
  readonly status: string
  readonly enquiryId: string
  readonly validUntil: string | null
  readonly mode: string | null
  readonly incoterm: string | null
  readonly customerNameEn: string | null
  readonly customerNameAr: string | null
  readonly originEn: string | null
  readonly originAr: string | null
  readonly destinationEn: string | null
  readonly destinationAr: string | null
}

/**
 * The facts the note is written from — the quote's own, plus its enquiry's lane.
 *
 * Read under the caller's actor, so a coordinator can only draft a note for a
 * quote RLS already lets them see. The lane and customer come from the enquiry
 * the quote hangs off, which is where they were captured.
 */
async function loadFacts(actor: Actor, quoteId: string): Promise<CoverNoteFacts | undefined> {
  const origin = alias(locations, 'cover_origin')
  const destination = alias(locations, 'cover_destination')

  const [row] = await withActor(actor, (tx: Tx) =>
    tx
      .select({
        reference: quotes.reference,
        status: quotes.status,
        enquiryId: quotes.enquiryId,
        validUntil: quotes.validUntil,
        mode: enquiries.mode,
        incoterm: enquiries.incoterm,
        customerNameEn: customers.legalNameEn,
        customerNameAr: customers.legalNameAr,
        originEn: origin.nameEn,
        originAr: origin.nameAr,
        destinationEn: destination.nameEn,
        destinationAr: destination.nameAr,
      })
      .from(quotes)
      .innerJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(origin, eq(origin.id, enquiries.originId))
      .leftJoin(destination, eq(destination.id, enquiries.destinationId))
      .where(eq(quotes.id, quoteId))
      .limit(1),
  )

  return row
}
