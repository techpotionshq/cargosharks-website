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

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { countryAliasCode } from '@qabandi/core'
import { commodities, countries, enquiries, locations } from './schema/index'
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

/**
 * The UN/LOCODEs a place name stands for, by the same rules as a proposal.
 *
 * For the rate-reply lane check (ai-4): an agent writes "Shanghai" and we
 * asked about CNSHA, and the only honest way to say whether those are the same
 * place is to ask the table a person would have picked from. Every match is
 * returned rather than one — the question here is "is ours among them", not
 * "which one is it", so a name two places share is not refused, only checked.
 */
export async function locationCodes(tx: Tx, value: string): Promise<string[]> {
  const needle = value.trim().toLowerCase()
  if (!needle) return []

  const rows = await tx
    .select({ code: locations.unlocode })
    .from(locations)
    .where(and(eq(locations.isActive, true), isNotNull(locations.unlocode), sqlAnyMatch(needle)))
    .limit(10)

  return rows.map((row) => row.code!).filter(Boolean)
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
/*
  The English name also matches with its generic suffix dropped. People write
  "Shuwaikh", the reference row says "Shuwaikh Port", and exact-only sent every
  such enquiry to a person. Still an exact comparison — "Shuaiba Port" becomes
  "shuaiba", never "shuwaikh" — and the one-match rule in `resolveProposal`
  still refuses a name two places share.
*/
/*
  The same forgiveness for the forms written the other way round: "Port of
  Shanghai" in English, and the Arabic name with or without its leading ميناء
  ("الشويخ" for "ميناء الشويخ"), which is how an Arabic email names a port as
  often as not (ai-4). A LOCODE written with a space ("KW SWK") is the code.
*/
const placeNeedle = (needle: string): string =>
  needle.replace(/^(the\s+)?port\s+of\s+/, '').replace(/^ميناء\s+/, '')

const sqlPlaceMatch = (raw: string) => {
  const needle = placeNeedle(raw)
  return sql`(lower(${locations.unlocode}) = ${needle.replace(/\s+/g, '')}
       or lower(${locations.nameEn}) = ${needle}
       or lower(regexp_replace(${locations.nameEn}, '\\s+(port|seaport|sea port|harbour|harbor)$', '', 'i')) = ${needle}
       or lower(${locations.nameAr}) = ${needle}
       or regexp_replace(${locations.nameAr}, '^ميناء\\s+', '') = ${needle})`
}

/*
  F60: the model writes a place the way an address is written — "Shuwaikh Port,
  Kuwait" — and the trailing country defeated every comparison above, so the
  route stayed incomplete and no rate request went out.

  The country after the last comma is dropped only when it *is* the location's
  own country, read from `countries` (code, English or Arabic name) rather than
  a list here, so a country an administrator adds is understood without a
  release. What is left must still match exactly by the rules above: "Shuaiba
  Port, Kuwait" is still Shuaiba, and "Shuwaikh, China" matches nothing,
  because a wrong country is a different place, not a typo to forgive. The
  Arabic comma is split on too — the same model writes "الشويخ، الكويت".
*/
const sqlAnyMatch = (needle: string) => {
  const comma = Math.max(needle.lastIndexOf(','), needle.lastIndexOf('،'))
  if (comma < 0) return sqlPlaceMatch(needle)

  const place = needle.slice(0, comma).trim()
  const country = needle.slice(comma + 1).trim()
  if (!place || !country) return sqlPlaceMatch(needle)

  // "UAE", "KSA" — the short forms the trade writes (ai-17).
  const alias = countryAliasCode(country) ?? ''

  return sql`(${sqlPlaceMatch(needle)}
       or (${sqlPlaceMatch(place)}
           and exists (select 1 from ${countries}
                        where ${countries.code} = ${locations.countryCode}
                          and (lower(${countries.code}) = ${country}
                               or ${countries.code} = ${alias}
                               or lower(${countries.nameEn}) = ${country}
                               or lower(${countries.nameAr}) = ${country}))))`
}

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
      isDangerous: enquiries.isDangerous,
    })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)

  if (!row) return null
  /*
    Dangerous goods was not selected, so it always read as empty and a
    proposal of "false" was applied over a flag a person had set (S20). The
    column is `not null default false`, so `false` is the unset state and
    reads as empty — a proposal may still raise the flag — while `true` is a
    held value a proposal can only put up for review, never clear.
  */
  if (column === 'isDangerous') return row.isDangerous ? 'true' : null
  const held = (row as Record<string, unknown>)[column]
  return held === null || held === undefined ? null : String(held)
}
