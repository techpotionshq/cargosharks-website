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
 * ## A draft that needs review says so
 *
 * Pricing freezes `review` into the quotation's snapshot — a charge sold below
 * its cost, or sold with nothing bought for it outside what the awarded rate
 * covers (`draftConcerns` in core has the rule and why). Such a draft is still
 * written, because it is the coordinator's starting point either way, but it
 * is counted as `flagged` and the quotation screen puts the reasons above the
 * lines. Nothing in the pipeline sends a quotation; this makes sure the person
 * who does is told what to look at first (ai-13).
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
  intakeNotReady,
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
  /** Of those, drafts marked as needing review before they are sent. */
  readonly flagged: number
  /** Eligible enquiries that could not be priced — no cover, no margin, or a gap. */
  readonly skipped: number
  /** Enquiries whose pricing threw — logged with the reason, retried next sweep. */
  readonly failed: number
}

const EMPTY: AutoDraftResult = { enabled: false, drafted: 0, flagged: 0, skipped: 0, failed: 0 }

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
  let flagged = 0
  let skipped = 0
  let failed = 0

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

      const [quote] = await withActor(actor, (tx) =>
        tx
          .select({ id: quotes.id, branchId: quotes.branchId, snapshot: quotes.pricedSnapshot })
          .from(quotes)
          .where(and(eq(quotes.enquiryId, candidate.enquiryId), eq(quotes.status, 'draft')))
          .orderBy(desc(quotes.version))
          .limit(1),
      )
      const review = quote?.snapshot?.review as { needed?: boolean } | undefined
      if (review?.needed) flagged += 1

      // Best-effort: the quotation stands even if the note cannot be drafted.
      try {
        if (quote) {
          await coverNote({ actor, branchId: quote.branchId, quoteId: quote.id, locale: 'en' })
        }
      } catch {
        // The note is prose; a failure here is not the sweep's problem.
      }
    } catch (error) {
      /*
        A throw is not a refusal. Refusals return above and are `skipped`; a
        throw is a fault in pricing or the database, and counting it as a skip
        made a pricing bug look the same as "no cover". Logged and counted
        apart, and the enquiry stays eligible for the next sweep.
      */
      failed += 1
      console.error(
        {
          enquiryId: candidate.enquiryId,
          error: error instanceof Error ? error.message : String(error),
        },
        'quote auto-draft: enquiry failed, left for the next sweep',
      )
    }
  }

  return { enabled: true, drafted, flagged, skipped, failed }
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
       -- Not while the intake agent is still collecting it (see rate-auto-fanout).
       and not ${intakeNotReady(sql`e.id`)}
     order by a.awarded_at desc, e.created_at desc
     limit ${ENQUIRY_BATCH}
  `)
  return result.rows as { enquiryId: string }[]
}
