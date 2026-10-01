/**
 * Automatic quotation draft — FR-EQ-05, the end of the pipeline.
 *
 * When an enquiry's buy rate has been awarded and its lane is covered, the same
 * engine "Price it" runs prices it against the customer's house margin and lands
 * a *draft* quotation — with its covering note drafted alongside. It is the last
 * automated step, and it stops one short of the customer: a draft is a thing a
 * coordinator reviews and decides to send, which is the one step the pipeline
 * leaves human by design.
 *
 * ## Eligibility, and the loop-breaker
 *
 * An enquiry qualifies when it has an accepted `rate_requests` row (a buy card
 * was awarded), it is still pre-quote, and it has no quotation yet. Pricing an
 * enquiry writes that quotation and moves it to `quoted`, so the next sweep
 * passes it by — the quote is its own loop-breaker.
 *
 * ## The covering note is best-effort
 *
 * The quotation is the deliverable; the note is prose on top of it. Drafting it
 * calls the model, so it is tried after the quote is written and never fails it —
 * a coordinator can draft the note by hand from the quote screen if the model
 * was unreachable. It is injected, so the tests never reach for a model.
 */

import { and, desc, eq, sql } from 'drizzle-orm'
import {
  priceEnquiryToQuote,
  quotes,
  systemActor,
  withActor,
  SYSTEM_PRINCIPAL_ID,
  type Actor,
  type Tx,
} from '@qabandi/db'
import { integration, type LiveIntegration } from '../settings'
import { draftQuoteCoverNote } from './quote-cover-note'

/** How many enquiries one sweep drafts — a backlog drains steadily. */
const ENQUIRY_BATCH = 50

export interface AutoDraftResult {
  readonly enabled: boolean
  /** Enquiries a draft quotation was written for. */
  readonly drafted: number
  /** Eligible enquiries that could not be priced — no cover, no margin, or a gap. */
  readonly skipped: number
}

const EMPTY: AutoDraftResult = { enabled: false, drafted: 0, skipped: 0 }

type CoverNoteDrafter = (input: {
  actor: Actor
  branchId: string
  quoteId: string
  locale: 'en' | 'ar'
}) => Promise<unknown>

export interface AutoDraftDeps {
  /** The resolved gate, injected in tests (the settings snapshot is cached). */
  readonly source?: LiveIntegration
  /** The cover-note drafter — injected in tests so no model is called. */
  readonly draftCoverNote?: CoverNoteDrafter
}

export async function autoDraftQuotes(deps: AutoDraftDeps = {}): Promise<AutoDraftResult> {
  const source = deps.source ?? (await integration('quoteAutoDraft'))
  if (source.driver !== 'auto') return EMPTY

  const actor = systemActor()
  const coverNote: CoverNoteDrafter = deps.draftCoverNote ?? ((input) => draftQuoteCoverNote(input))
  const eligible = await withActor(actor, (tx) => loadEligible(tx))

  let drafted = 0
  let skipped = 0

  for (const candidate of eligible) {
    try {
      const outcome = await withActor(actor, (tx) =>
        // First quotation only: a coordinator who priced it since the candidate
        // list was read keeps their draft (S19).
        priceEnquiryToQuote(tx, candidate.enquiryId, SYSTEM_PRINCIPAL_ID, { firstOnly: true }),
      )
      if (!('reference' in outcome)) {
        // No cover, no house margin, or a figure the enquiry does not carry —
        // left for a person to price rather than guessed at.
        skipped += 1
        continue
      }
      drafted += 1

      // Best-effort: the quotation stands even if the note cannot be drafted.
      try {
        const [quote] = await withActor(actor, (tx) =>
          tx
            .select({ id: quotes.id, branchId: quotes.branchId })
            .from(quotes)
            .where(and(eq(quotes.enquiryId, candidate.enquiryId), eq(quotes.status, 'draft')))
            .orderBy(desc(quotes.version))
            .limit(1),
        )
        if (quote) {
          await coverNote({ actor, branchId: quote.branchId, quoteId: quote.id, locale: 'en' })
        }
      } catch {
        // The note is prose; a failure here is not the sweep's problem.
      }
    } catch {
      skipped += 1
    }
  }

  return { enabled: true, drafted, skipped }
}

/**
 * Enquiries with an awarded buy rate, still pre-quote and not yet quoted.
 *
 * An enquiry pricing refuses writes no quote, so it stays eligible. With no
 * order the same fifty came back every sweep, and fifty refusals starved every
 * enquiry behind them. Two guards: a sea FCL enquiry with no container count
 * is left out (pricing refuses it until a person enters one), and the newest
 * *award* comes first, so a fresh award is drafted even behind a backlog of
 * refusals. Ordered by when the rate was accepted, not by the enquiry's age
 * (R4): an old enquiry awarded today sat behind fifty newer ones that
 * `no_margin` refuses every sweep.
 */
async function loadEligible(tx: Tx): Promise<{ enquiryId: string }[]> {
  const result = await tx.execute(sql`
    select e.id as "enquiryId"
      from enquiries e
      join lateral (
        select max(r.updated_at) as awarded_at
          from rate_requests r
         where r.enquiry_id = e.id and r.status = 'accepted'
      ) a on a.awarded_at is not null
     where e.status in ('new', 'assigned', 'rating')
       and not exists (select 1 from quotes q where q.enquiry_id = e.id)
       and (e.mode is distinct from 'sea_fcl' or e.container_count is not null)
     order by a.awarded_at desc, e.created_at desc
     limit ${ENQUIRY_BATCH}
  `)
  return result.rows as { enquiryId: string }[]
}
