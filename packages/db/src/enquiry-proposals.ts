/**
 * Turning one extraction proposal into the enquiry column and value a write
 * would set — `AI-05`, `AI-07`.
 *
 * This lived in `apps/web` when a person accepting a proposal was the only
 * caller. It moved here the day a second caller appeared: the service's
 * auto-accept path applies the same proposals without a click, and the one rule
 * that must never differ between the two is the ambiguity refusal — a confident
 * tie-break between two ports is exactly how the wrong row gets written, and a
 * second copy of that logic is a second place for it to be softened. One
 * definition, both callers.
 *
 * ## The three candidates are resolved here, never by the model
 *
 * `origin`, `destination` and `commodity` arrive as text — "Shanghai",
 * "aluminium fittings" — because a model that emitted `origin_id` would be
 * choosing a row in our database from text a stranger emailed us. Resolution
 * happens at accept time against the reference tables and refuses ambiguity in
 * both directions: no match is refused, and *two* matches are refused just as
 * firmly. A refusal is not a dead end — the coordinator is told what was
 * ambiguous and types the field, and the auto-accept path simply leaves it in
 * the queue for them.
 */

import { and, eq, sql } from 'drizzle-orm'
import { commodities, enquiries, locations } from './schema/index'
import type { Tx } from './actor'

/**
 * What a field would have accepted, as a kind rather than a phrase.
 *
 * This used to be English — "a number", "true or false" — interpolated into a
 * catalogue sentence, so the Arabic screen read as Arabic with an English
 * hole in the middle. The caller owns the catalogue and turns the kind into
 * words. `oneOf` keeps its list as the stored codes (`sea_fcl`, `air`), which
 * is what the proposal row itself shows beside the refusal.
 */
export type ExpectedValue =
  | { readonly kind: 'number' }
  | { readonly kind: 'integer' }
  | { readonly kind: 'positiveInteger' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'date' }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }

/** Why a proposal could not be applied, in a form a caller turns into a sentence. */
export type ResolutionFailure =
  | { readonly kind: 'unknown_field' }
  | { readonly kind: 'not_found'; readonly value: string }
  | { readonly kind: 'ambiguous'; readonly value: string; readonly count: number }
  | { readonly kind: 'invalid'; readonly value: string; readonly expected: ExpectedValue }

export type Resolution =
  | { readonly ok: true; readonly column: string; readonly value: unknown }
  | { readonly ok: false; readonly failure: ResolutionFailure }

export const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier']
export const DIRECTIONS = ['import', 'export', 'cross_trade']

/**
 * One proposal, turned into the column and value an update would write.
 *
 * Takes the transaction, because the three candidates need reference lookups and
 * those must run inside the same actored transaction as the write — a location
 * resolved outside it is a location resolved under different visibility rules
 * than the one the update will use.
 */
export async function resolveProposal(tx: Tx, field: string, raw: string): Promise<Resolution> {
  const value = raw.trim()

  switch (field) {
    case 'mode':
      return MODES.includes(value)
        ? { ok: true, column: 'mode', value }
        : { ok: false, failure: invalid(value, { kind: 'oneOf', values: MODES }) }

    case 'tradeDirection':
      return DIRECTIONS.includes(value)
        ? { ok: true, column: 'tradeDirection', value }
        : { ok: false, failure: invalid(value, { kind: 'oneOf', values: DIRECTIONS }) }

    case 'incoterm':
      return { ok: true, column: 'incoterm', value: value.toUpperCase() }

    case 'readyOn':
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { ok: true, column: 'readyOn', value }
        : { ok: false, failure: invalid(value, { kind: 'date' }) }

    /*
      Money is text and so is every quantity — the numbers stay strings all the
      way into `numeric`, which is the rule everywhere else in this system and is
      not relaxed because a model produced them.
    */
    case 'grossWeightKg':
    case 'volumeCbm':
      return /^\d+(\.\d{1,6})?$/.test(value)
        ? { ok: true, column: field, value }
        : { ok: false, failure: invalid(value, { kind: 'number' }) }

    case 'pieces':
      return /^\d{1,9}$/.test(value)
        ? { ok: true, column: 'pieces', value: Number(value) }
        : { ok: false, failure: invalid(value, { kind: 'integer' }) }

    /*
      Positive, not merely whole: `enquiries_container_count_positive` (0048)
      refuses a zero, and a proposal that resolved only to fail the constraint
      would surface as a server error rather than a sentence the coordinator
      can act on. The same ceiling as `setEnquiryContainerCount`'s form.
    */
    case 'containerCount':
      return /^[1-9]\d{0,3}$/.test(value)
        ? { ok: true, column: 'containerCount', value: Number(value) }
        : { ok: false, failure: invalid(value, { kind: 'positiveInteger' }) }

    case 'dimensions':
      return { ok: true, column: 'dimensions', value }

    case 'isDangerous':
      return /^(true|false)$/i.test(value)
        ? { ok: true, column: 'isDangerous', value: value.toLowerCase() === 'true' }
        : { ok: false, failure: invalid(value, { kind: 'boolean' }) }

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

function invalid(value: string, expected: ExpectedValue): ResolutionFailure {
  return { kind: 'invalid', value, expected }
}

/**
 * A place name or UN/LOCODE, against the places we hold.
 *
 * Case-insensitive on the code and on both names, and nothing cleverer. A fuzzy
 * match is how "Shuwaikh" quietly becomes "Shuaiba" — twenty kilometres and a
 * different port authority — and the cost of refusing is that somebody picks
 * from a dropdown they were going to see anyway.
 */
async function matchLocation(tx: Tx, value: string): Promise<{ id: string }[]> {
  const needle = value.trim().toLowerCase()

  return tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.isActive, true), sqlAnyMatch(needle)))
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
      containerCount: enquiries.containerCount,
      dimensions: enquiries.dimensions,
    })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)

  if (!row) return null
  const held = (row as Record<string, unknown>)[column]
  return held === null || held === undefined ? null : String(held)
}
