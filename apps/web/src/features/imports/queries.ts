/**
 * Reference sets and collision sets for the importer.
 *
 * Read once per import rather than per row. Validating a two-thousand-row
 * agent tariff then costs two thousand set lookups and four round trips, not
 * eight thousand queries — which is the whole reason `@qabandi/core/import`
 * takes the codes as sets rather than reaching for a database it cannot see.
 */

import { eq, inArray, sql } from 'drizzle-orm'
import {
  branches,
  chargeTypes,
  countries,
  currencies,
  customers,
  locations,
  partners,
  withActor,
  type Actor,
} from '@qabandi/db'
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

    const needsCountries = kind !== 'rate-cards' && kind !== 'customer-contacts'
    const needsCurrencies = kind === 'customers' || kind === 'partners' || kind === 'rate-cards'

    if (needsCountries) {
      const rows = await tx.select({ code: countries.code }).from(countries)
      lookups.countries = new Set(rows.map((row) => row.code.toUpperCase()))
    }

    if (needsCurrencies) {
      const rows = await tx.select({ code: currencies.code }).from(currencies)
      lookups.currencies = new Set(rows.map((row) => row.code.toUpperCase()))
    }

    if (kind === 'rate-cards') {
      const [places, charges] = await Promise.all([
        tx.select({ unlocode: locations.unlocode }).from(locations),
        tx.select({ key: chargeTypes.key }).from(chargeTypes),
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

/** Branches the principal may import into, for the destination selector. */
export async function importableBranches(
  actor: Actor,
): Promise<{ id: string; code: string; nameEn: string }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({ id: branches.id, code: branches.code, nameEn: branches.legalNameEn })
      .from(branches)
      .where(eq(branches.isActive, true)),
  )
}

/** Active agents and carriers, for the rate-card sheet's owning partner. */
export async function ratePartners(
  actor: Actor,
): Promise<{ id: string; code: string; nameEn: string }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({ id: partners.id, code: partners.code, nameEn: partners.legalNameEn })
      .from(partners)
      .where(eq(partners.isActive, true)),
  )
}
