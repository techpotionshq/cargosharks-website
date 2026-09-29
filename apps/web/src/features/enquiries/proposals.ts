import 'server-only'

/**
 * The review queue for what a model read — `AI-05`, `AI-07`.
 *
 * `enquiry-extract.ts` writes to `extraction_proposals` and never touches
 * `enquiries`. This is the other half of that decision: the screen where a
 * person turns a proposal into a fact, under their own actor, so the audit
 * trail answers *who put this on the shipment* without inventing a concept to
 * answer it.
 *
 * ## Accepting is an ordinary write, and that is the whole design
 *
 * Nothing here is a special "AI write". Accepting `mode = sea_fcl` updates the
 * column exactly as the enquiry form does, under the coordinator's actor, with
 * the same row-level security and the same audit trigger. The proposal row is
 * then closed. If every model in this system were switched off tomorrow, the
 * enquiries would carry the same values put there the same way.
 *
 * ## The resolver is shared, not local
 *
 * Turning a proposal into a column and value — including the ambiguity refusal
 * for `origin`, `destination` and `commodity` — moved to `@qabandi/db` the day
 * the service's auto-accept path became a second caller. One copy of that
 * refusal, because a confident tie-break between two ports is how the wrong row
 * gets written and a second copy is a second place to soften it. It is
 * re-exported below so the form actions and the panel still import it from here.
 */

import { and, asc, eq, isNull } from 'drizzle-orm'
import { aiInvocations, extractionProposals, withActor, type Actor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotEnquiryProposals } from '@/lib/pilot/fixtures'

export {
  resolveProposal,
  enquiryColumn,
  MODES,
  DIRECTIONS,
  type Resolution,
  type ResolutionFailure,
} from '@qabandi/db'

/** One proposal, as the panel shows it. */
export interface EnquiryProposal {
  readonly id: string
  /** The extraction field — `origin`, not `origin_id`. See `COLUMN` in the worker. */
  readonly field: string
  readonly value: string
  readonly confidence: string | null
  readonly evidence: string | null
  /** Whether the column was empty when the model was asked. */
  readonly targetWasEmpty: boolean
  /** What answered, so a bad run is attributable to a model and a prompt. */
  readonly model: string | null
  readonly promptVersion: string | null
}

/**
 * Open proposals against one enquiry, oldest first.
 *
 * No branch filter, because `withActor` means RLS applies one — the absence is
 * the point, as this feature's `queries.ts` says at length.
 */
export async function enquiryProposals(
  actor: Actor,
  enquiryId: string,
): Promise<EnquiryProposal[]> {
  /*
    The queue is seeded like everything else offline — and it has to be, not
    just for the crash: `ProposalsPanel` awaits this on every enquiry file, so
    an un-branched read here took the whole screen down rather than showing an
    empty panel. One enquiry on the fixture board arrived by mail and carries
    proposals; the rest return nothing, and the panel renders nothing, which is
    what it does against a real database too.
  */
  if (usePilotFixtures()) return pilotEnquiryProposals(enquiryId)

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: extractionProposals.id,
        field: extractionProposals.field,
        value: extractionProposals.value,
        confidence: extractionProposals.confidence,
        evidence: extractionProposals.evidence,
        targetWasEmpty: extractionProposals.targetWasEmpty,
        model: aiInvocations.modelServed,
        promptVersion: aiInvocations.promptVersion,
      })
      .from(extractionProposals)
      .leftJoin(aiInvocations, eq(aiInvocations.id, extractionProposals.invocationId))
      .where(
        and(
          eq(extractionProposals.targetTable, 'enquiries'),
          eq(extractionProposals.targetId, enquiryId),
          eq(extractionProposals.status, 'proposed'),
          isNull(extractionProposals.closedAt),
        ),
      )
      .orderBy(asc(extractionProposals.createdAt)),
  )
}
