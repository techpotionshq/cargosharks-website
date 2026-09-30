/**
 * Reference sets and collision sets for the importer.
 *
 * Read once per import rather than per row. Validating a two-thousand-row
 * agent tariff then costs two thousand set lookups and four round trips, not
 * eight thousand queries — which is the whole reason `@qabandi/core/import`
 * takes the codes as sets rather than reaching for a database it cannot see.
 */

import { eq, inArray, isNotNull, sql } from 'drizzle-orm'
import {
  branches,
  chargeTypes,
  countries,
  currencies,
  customers,
  incoterms,
  inSeries,
  invoices,
  jobs,
  locations,
  partners,
  withActor,
  type Actor,
} from '@qabandi/db'
import { named } from '@/lib/named'
import type { ImportKind } from './descriptors'

export interface ImportReference {
  readonly lookups: Record<string, ReadonlySet<string>>
  readonly existing: Record<string, ReadonlySet<string>>
}

/**
 * Only what the chosen sheet needs.
 *
 * A customer import has no reason to read every UN/LOCODE, and a location
 * import has no reason to read the charge catalogue.
 */
export async function loadReference(actor: Actor, kind: ImportKind): Promise<ImportReference> {
  return withActor(actor, async (tx) => {
    const lookups: Record<string, ReadonlySet<string>> = {}
    const existing: Record<string, ReadonlySet<string>> = {}

    const isCutover = kind === 'open-jobs' || kind === 'open-receivables'
    const needsCountries = kind !== 'rate-cards' && kind !== 'customer-contacts' && !isCutover
    const needsCurrencies =
      kind === 'customers' ||
      kind === 'partners' ||
      kind === 'rate-cards' ||
      kind === 'open-receivables'

    if (needsCountries) {
      const rows = await tx.select({ code: countries.code }).from(countries)
      lookups.countries = new Set(rows.map((row) => row.code.toUpperCase()))
    }

    if (needsCurrencies) {
      const rows = await tx.select({ code: currencies.code }).from(currencies)
      lookups.currencies = new Set(rows.map((row) => row.code.toUpperCase()))
    }

    if (kind === 'rate-cards') {
      const [places, charges] = await inSeries([
        () => tx.select({ unlocode: locations.unlocode }).from(locations),
        () => tx.select({ key: chargeTypes.key }).from(chargeTypes),
      ])
      lookups.locations = new Set(
        places
          .map((row) => row.unlocode?.toUpperCase())
          .filter((value): value is string => Boolean(value)),
      )
      lookups.chargeTypes = new Set(charges.map((row) => row.key.toUpperCase()))
    }

    // Collision sets — reported as an error rather than silently updating,
    // because an import that overwrites is not an import, it is a merge, and
    // nobody asked for one.
    if (kind === 'customers') {
      const rows = await tx.select({ code: customers.code }).from(customers)
      existing.code = new Set(rows.map((row) => row.code.toUpperCase()))
    }
    if (kind === 'partners') {
      const rows = await tx.select({ code: partners.code }).from(partners)
      existing.code = new Set(rows.map((row) => row.code.toUpperCase()))
    }
    if (kind === 'locations') {
      const rows = await tx.select({ unlocode: locations.unlocode }).from(locations)
      existing.unlocode = new Set(
        rows
          .map((row) => row.unlocode?.toUpperCase())
          .filter((value): value is string => Boolean(value)),
      )
    }

    /*
      The cutover sheets.

      Ports and Incoterms are optional on a job but must exist where given —
      a handover sheet with `JEBEL ALI` in the POL column should be corrected
      before go-live, not silently imported as a job with no origin.

      The collision set is the one that matters most here: a migration is
      almost never run once. It is run against a dry copy, corrected, and run
      again, and the second run must refuse the references the first one
      created rather than producing a duplicate board.
    */
    if (kind === 'open-jobs') {
      const [places, terms, references] = await inSeries([
        () => tx.select({ unlocode: locations.unlocode }).from(locations),
        () => tx.select({ code: incoterms.code }).from(incoterms),
        () => tx.select({ reference: jobs.reference }).from(jobs),
      ])
      lookups.locations = new Set(
        places
          .map((row) => row.unlocode?.toUpperCase())
          .filter((value): value is string => Boolean(value)),
      )
      lookups.incoterms = new Set(terms.map((row) => row.code.toUpperCase()))
      existing.reference = new Set(references.map((row) => row.reference.toUpperCase()))
    }

    if (kind === 'open-receivables') {
      /*
        Invoice numbers are unique *per branch series*, not globally — five
        legal entities each number their own (FR-ID-01). The collision set is
        therefore branch-agnostic here and deliberately loose: it catches the
        same file imported twice, which is the failure worth catching, and
        leaves genuine cross-entity duplicates to the branch the import runs
        against.
      */
      const rows = await tx
        .select({ seriesNo: invoices.seriesNo })
        .from(invoices)
        .where(isNotNull(invoices.seriesNo))
      existing.seriesNo = new Set(
        rows
          .map((row) => row.seriesNo?.toUpperCase())
          .filter((value): value is string => Boolean(value)),
      )
    }

    return { lookups, existing }
  })
}

/**
 * Codes back to ids — and the case trap that made this the one function here
 * a unit test could not have caught.
 *
 * `lookup()` upper-cases whatever the operator typed, because a UN/LOCODE and
 * an ISO currency are upper-case by definition. A **charge-type key is not**:
 * the catalogue stores `ocean_freight`, lower-case snake case. Filtering
 * `where key in ('OCEAN_FREIGHT')` therefore matched nothing, the id map came
 * back empty, and a perfectly valid tariff failed at the write with
 * `unknown_reference` after passing every validation.
 *
 * Both sides are compared upper-cased so the join is on the same footing the
 * validator used. `upper()` on the column forgoes the plain index, which costs
 * nothing at these sizes — the charge catalogue is twenty-one admin-managed
 * rows and the lane set of one tariff is tens.
 */
export async function resolveRateReferences(
  actor: Actor,
  unlocodes: readonly string[],
  chargeKeys: readonly string[],
): Promise<{
  locationIds: Map<string, string>
  chargeTypeIds: Map<string, string>
}> {
  return withActor(actor, async (tx) => {
    const locationIds = new Map<string, string>()
    const chargeTypeIds = new Map<string, string>()

    if (unlocodes.length > 0) {
      const wanted = [...new Set(unlocodes.map((code) => code.toUpperCase()))]
      const rows = await tx
        .select({ id: locations.id, unlocode: locations.unlocode })
        .from(locations)
        .where(inArray(sql`upper(${locations.unlocode})`, wanted))
      for (const row of rows) {
        if (row.unlocode) locationIds.set(row.unlocode.toUpperCase(), row.id)
      }
    }

    if (chargeKeys.length > 0) {
      const wanted = [...new Set(chargeKeys.map((key) => key.toUpperCase()))]
      const rows = await tx
        .select({ id: chargeTypes.id, key: chargeTypes.key })
        .from(chargeTypes)
        .where(inArray(sql`upper(${chargeTypes.key})`, wanted))
      for (const row of rows) chargeTypeIds.set(row.key.toUpperCase(), row.id)
    }

    return { locationIds, chargeTypeIds }
  })
}

/** Customer codes to ids, for the contact sheet's `Customer code` column. */
export async function resolveCustomerCodes(
  actor: Actor,
  codes: readonly string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map()
  return withActor(actor, async (tx) => {
    // Upper-cased on both sides, for the same reason as the charge keys above.
    const wanted = [...new Set(codes.map((code) => code.toUpperCase()))]
    const rows = await tx
      .select({ id: customers.id, code: customers.code })
      .from(customers)
      .where(inArray(sql`upper(${customers.code})`, wanted))
    return new Map(rows.map((row) => [row.code.toUpperCase(), row.id]))
  })
}

/**
 * Branches the principal may import into, for the destination selector.
 * `locale` names them in the reader's language (F27).
 */
export async function importableBranches(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
): Promise<{ id: string; code: string; name: string }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: branches.id,
        code: branches.code,
        name: named(locale, branches.legalNameEn, branches.legalNameAr),
      })
      .from(branches)
      .where(eq(branches.isActive, true)),
  )
}

/**
 * Active agents and carriers, for the rate-card sheet's owning partner.
 * `locale` names them in the reader's language (F27).
 */
export async function ratePartners(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
): Promise<{ id: string; code: string; name: string }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: partners.id,
        code: partners.code,
        name: named(locale, partners.legalNameEn, partners.legalNameAr),
      })
      .from(partners)
      .where(eq(partners.isActive, true)),
  )
}

/**
 * Locations, Incoterms and job references back to ids, for the open-jobs
 * writer.
 *
 * Upper-cased on both sides for the reason recorded above `resolveRateReferences`:
 * `lookup()` upper-cases what the operator typed, so a join against the stored
 * value has to do the same or it silently matches nothing and fails at the
 * write rather than at validation.
 */
export async function resolveJobReferences(
  actor: Actor,
  unlocodes: readonly string[],
  incotermCodes: readonly string[],
): Promise<{ locationIds: Map<string, string>; incoterms: Map<string, string> }> {
  return withActor(actor, async (tx) => {
    const locationIds = new Map<string, string>()
    const terms = new Map<string, string>()

    if (unlocodes.length > 0) {
      const wanted = [...new Set(unlocodes.map((value) => value.toUpperCase()))]
      const rows = await tx
        .select({ id: locations.id, unlocode: locations.unlocode })
        .from(locations)
        .where(inArray(sql`upper(${locations.unlocode})`, wanted))
      for (const row of rows) {
        if (row.unlocode) locationIds.set(row.unlocode.toUpperCase(), row.id)
      }
    }

    if (incotermCodes.length > 0) {
      const wanted = [...new Set(incotermCodes.map((value) => value.toUpperCase()))]
      const rows = await tx
        .select({ code: incoterms.code })
        .from(incoterms)
        .where(inArray(sql`upper(${incoterms.code})`, wanted))
      // Stored as written rather than as typed: the column holds the canonical
      // three-letter term and the sheet may have carried any casing.
      for (const row of rows) terms.set(row.code.toUpperCase(), row.code)
    }

    return { locationIds, incoterms: terms }
  })
}

/**
 * Job references back to ids, for linking an opening receivable to a shipment.
 *
 * Returns only what it finds. An unmatched reference on a receivable is not an
 * error — plenty of open invoices at cutover relate to jobs already closed in
 * the old system, and refusing them would mean refusing the balance.
 */
export async function resolveJobsByReference(
  actor: Actor,
  references: readonly string[],
): Promise<Map<string, { id: string; branchId: string }>> {
  if (references.length === 0) return new Map()

  return withActor(actor, async (tx) => {
    const wanted = [...new Set(references.map((value) => value.toUpperCase()))]
    const rows = await tx
      .select({ id: jobs.id, reference: jobs.reference, branchId: jobs.branchId })
      .from(jobs)
      .where(inArray(sql`upper(${jobs.reference})`, wanted))
    return new Map(
      rows.map((row) => [row.reference.toUpperCase(), { id: row.id, branchId: row.branchId }]),
    )
  })
}
