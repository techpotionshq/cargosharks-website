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
 * ## The three candidates are resolved here, never by the model
 *
 * `origin`, `destination` and `commodity` arrive as text — "Shanghai",
 * "aluminium fittings" — because a model that emitted `origin_id` would be
 * choosing a row in our database from text a stranger emailed us. Resolution
 * happens at accept time against the reference tables, and it refuses
 * ambiguity in both directions: no match is refused, and *two* matches are
 * refused just as firmly. `inbound-routing.ts` makes the same refusal for the
 * same reason — a confident tie-break is precisely how the wrong row gets
 * written.
 *
 * A refusal is not a dead end. The coordinator is told what was ambiguous and
 * types the field, which is where they were before extraction existed.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import {
  aiInvocations,
  commodities,
  enquiries,
  extractionProposals,
  locations,
  withActor,
  type Actor,
  type Tx,
} from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotEnquiryProposals } from '@/lib/pilot/fixtures'

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

/** Why a proposal could not be applied, in a form the action turns into a sentence. */
export type ResolutionFailure =
  | { readonly kind: 'unknown_field' }
  | { readonly kind: 'not_found'; readonly value: string }
  | { readonly kind: 'ambiguous'; readonly value: string; readonly count: number }
  | { readonly kind: 'invalid'; readonly value: string; readonly expected: string }

export type Resolution =
  | { readonly ok: true; readonly column: string; readonly value: unknown }
  | { readonly ok: false; readonly failure: ResolutionFailure }

export const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier']
export const DIRECTIONS = ['import', 'export', 'cross_trade']

/**
 * One proposal, turned into the column and value an update would write.
 *
 * Takes the transaction, because the three candidates need reference lookups
 * and those must run inside the same actored transaction as the write — a
 * location resolved outside it is a location resolved under different
 * visibility rules than the one the update will use.
 */
export async function resolveProposal(tx: Tx, field: string, raw: string): Promise<Resolution> {
  const value = raw.trim()

  switch (field) {
    case 'mode':
      return MODES.includes(value)
        ? { ok: true, column: 'mode', value }
        : { ok: false, failure: { kind: 'invalid', value, expected: MODES.join(', ') } }

    case 'tradeDirection':
      return DIRECTIONS.includes(value)
        ? { ok: true, column: 'tradeDirection', value }
        : { ok: false, failure: { kind: 'invalid', value, expected: DIRECTIONS.join(', ') } }

    case 'incoterm':
      return { ok: true, column: 'incoterm', value: value.toUpperCase() }

    case 'readyOn':
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { ok: true, column: 'readyOn', value }
        : { ok: false, failure: { kind: 'invalid', value, expected: 'YYYY-MM-DD' } }

    /*
      Money is text and so is every quantity — the numbers stay strings all the
      way into `numeric`, which is the rule everywhere else in this system and
      is not relaxed because a model produced them. A `Number()` here would put
      a double in the one path whose whole justification is that it does not.
    */
    case 'grossWeightKg':
    case 'volumeCbm':
      return /^\d+(\.\d{1,6})?$/.test(value)
        ? { ok: true, column: field, value }
        : { ok: false, failure: { kind: 'invalid', value, expected: 'a number' } }

    case 'pieces':
      return /^\d{1,9}$/.test(value)
        ? { ok: true, column: 'pieces', value: Number(value) }
        : { ok: false, failure: { kind: 'invalid', value, expected: 'a whole number' } }

    case 'dimensions':
      return { ok: true, column: 'dimensions', value }

    case 'isDangerous':
      return /^(true|false)$/i.test(value)
        ? { ok: true, column: 'isDangerous', value: value.toLowerCase() === 'true' }
        : { ok: false, failure: { kind: 'invalid', value, expected: 'true or false' } }

    case 'origin':
    case 'destination': {
      const matches = await matchLocation(tx, value)
      if (matches.length === 0) return { ok: false, failure: { kind: 'not_found', value } }
      if (matches.length > 1) {
        return { ok: false, failure: { kind: 'ambiguous', value, count: matches.length } }
      }
      return {
        ok: true,
        column: field === 'origin' ? 'originId' : 'destinationId',
        value: matches[0]!.id,
      }
    }

    case 'commodity': {
      const matches = await matchCommodity(tx, value)
      if (matches.length === 0) return { ok: false, failure: { kind: 'not_found', value } }
      if (matches.length > 1) {
        return { ok: false, failure: { kind: 'ambiguous', value, count: matches.length } }
      }
      return { ok: true, column: 'commodityId', value: matches[0]!.id }
    }

    default:
      return { ok: false, failure: { kind: 'unknown_field' } }
  }
}

/**
 * A place name or UN/LOCODE, against the places we hold.
 *
 * Case-insensitive on the code and on both names, and nothing cleverer. A
 * fuzzy match is how "Shuwaikh" quietly becomes "Shuaiba" — twenty kilometres
 * and a different port authority — and the cost of refusing is that somebody
 * picks from a dropdown they were going to see anyway.
 */
async function matchLocation(tx: Tx, value: string): Promise<{ id: string }[]> {
  const needle = value.trim().toLowerCase()

  return tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.isActive, true),
        // `or` is expressed as a raw comparison set so the index on unlocode is usable.
        sqlAnyMatch(needle),
      ),
    )
    .limit(5)
}

async function matchCommodity(tx: Tx, value: string): Promise<{ id: string }[]> {
  const needle = value.trim().toLowerCase()

  return tx
    .select({ id: commodities.id })
    .from(commodities)
    .where(and(eq(commodities.isActive, true), sqlAnyCommodity(needle)))
    .limit(5)
}

/* The comparison sets, kept beside their callers so the columns are visible. */
const sqlAnyMatch = (needle: string) =>
  sql`(lower(${locations.unlocode}) = ${needle}
       or lower(${locations.nameEn}) = ${needle}
       or lower(${locations.nameAr}) = ${needle})`

const sqlAnyCommodity = (needle: string) =>
  sql`(lower(${commodities.code}) = ${needle}
       or lower(${commodities.nameEn}) = ${needle}
       or lower(${commodities.nameAr}) = ${needle})`

/** The enquiry row as `decideProposal` needs to see it at accept time. */
export async function enquiryColumn(
  tx: Tx,
  enquiryId: string,
  column: string,
): Promise<string | null> {
  const [row] = await tx
    .select({
      mode: enquiries.mode,
      tradeDirection: enquiries.tradeDirection,
      originId: enquiries.originId,
      destinationId: enquiries.destinationId,
      commodityId: enquiries.commodityId,
      incoterm: enquiries.incoterm,
      readyOn: enquiries.readyOn,
      grossWeightKg: enquiries.grossWeightKg,
      volumeCbm: enquiries.volumeCbm,
      pieces: enquiries.pieces,
      dimensions: enquiries.dimensions,
    })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)

  if (!row) return null
  const held = (row as Record<string, unknown>)[column]
  return held === null || held === undefined ? null : String(held)
}
