/**
 * The reference sets an import is validated against, and the code-to-id joins
 * that follow it.
 *
 * These are read once per import rather than once per row, which is the whole
 * reason `@qabandi/core/import` takes sets instead of reaching for a database
 * it cannot see. Two properties are therefore worth pinning here and nowhere
 * else:
 *
 * **Only what the sheet needs is read.** A customer import has no business
 * loading every UN/LOCODE. Asserting the *absence* of a set matters as much as
 * its presence — a loader that always loads everything passes every
 * correctness test and quietly costs four extra round trips per import.
 *
 * **The joins upper-case both sides.** A UN/LOCODE and an ISO currency are
 * upper-case by definition; a charge-type key is `ocean_freight`, lower-case
 * snake case. `lookup()` upper-cases whatever the operator typed, so a join
 * against the stored value has to do the same — otherwise a valid tariff
 * passes every validation and fails at the write with `unknown_reference`,
 * which is exactly the bug the comment above `resolveRateReferences` records.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { AWAY_JOB, HOME_JOB, bothBranchesActor, world } = await import('@/lib/testing/fixtures')

const {
  importableBranches,
  loadReference,
  ratePartners,
  resolveCustomerCodes,
  resolveJobReferences,
  resolveJobsByReference,
  resolveRateReferences,
} = await import('./queries')

describe.skipIf(!enabled)('import reference data', () => {
  beforeAll(async () => {
    await world()
  })

  describe('what each sheet reads', () => {
    it('gives a customer sheet its countries, currencies and taken codes', async () => {
      const reference = await loadReference(bothBranchesActor, 'customers')

      expect(reference.lookups.countries).toContain('KW')
      expect(reference.lookups.currencies).toContain('KWD')
      expect(reference.existing.code).toContain('CUST-FIXTURE-HOME')
    })

    /** A contact sheet carries no country and no currency column. */
    it('reads neither countries nor currencies for a contact sheet', async () => {
      const reference = await loadReference(bothBranchesActor, 'customer-contacts')

      expect(reference.lookups.countries).toBeUndefined()
      expect(reference.lookups.currencies).toBeUndefined()
    })

    it('gives a partner sheet the codes already taken', async () => {
      const reference = await loadReference(bothBranchesActor, 'partners')

      expect(reference.existing.code).toContain('AGT-FIXTURE')
      expect(reference.lookups.currencies).toContain('KWD')
    })

    it('gives a location sheet the UN/LOCODEs already in use', async () => {
      const reference = await loadReference(bothBranchesActor, 'locations')

      expect(reference.existing.unlocode).toContain('KWSWK')
    })

    /**
     * The charge catalogue is upper-cased on the way into the set because the
     * validator upper-cases what it compares. Both sides or neither.
     */
    it('gives a tariff its lanes and charge catalogue, upper-cased', async () => {
      const reference = await loadReference(bothBranchesActor, 'rate-cards')

      expect(reference.lookups.locations).toContain('KWSWK')
      expect(reference.lookups.chargeTypes).toContain('OCEAN_FREIGHT')
      // Not needed by a tariff, and so not read.
      expect(reference.lookups.countries).toBeUndefined()
    })

    /**
     * A migration is almost never run once — it is run against a dry copy,
     * corrected, and run again. The collision set is what makes the second run
     * refuse the references the first one created.
     */
    it('gives a cutover job sheet its Incoterms and the references already taken', async () => {
      const reference = await loadReference(bothBranchesActor, 'open-jobs')

      expect(reference.lookups.incoterms).toContain('FOB')
      expect(reference.lookups.locations).toContain('KWSWK')
      expect(reference.existing.reference).toContain('FXH-JOB-FIXTURE-1')
      // A handover sheet has no country column.
      expect(reference.lookups.countries).toBeUndefined()
    })

    it('gives a cutover receivables sheet its currencies and issued numbers', async () => {
      const reference = await loadReference(bothBranchesActor, 'open-receivables')

      expect(reference.lookups.currencies).toContain('KWD')
      expect(reference.existing.seriesNo).toBeDefined()
      expect(reference.lookups.countries).toBeUndefined()
    })
  })

  describe('codes back to ids', () => {
    /**
     * The case trap, asserted from both directions. A charge key is stored
     * lower-case and arrives from the validator upper-case; matching only one
     * of those is how a valid tariff failed at the write.
     */
    it('finds a charge type whichever way the sheet spelled it', async () => {
      const upper = await resolveRateReferences(bothBranchesActor, [], ['OCEAN_FREIGHT'])
      const lower = await resolveRateReferences(bothBranchesActor, [], ['ocean_freight'])

      expect(upper.chargeTypeIds.get('OCEAN_FREIGHT')).toBeDefined()
      expect(lower.chargeTypeIds.get('OCEAN_FREIGHT')).toBe(
        upper.chargeTypeIds.get('OCEAN_FREIGHT'),
      )
    })

    it('finds a lane whichever way the sheet spelled it', async () => {
      const { locationIds } = await resolveRateReferences(bothBranchesActor, ['kwswk'], [])
      expect(locationIds.get('KWSWK')).toBeDefined()
    })

    it('returns nothing for a charge the catalogue does not carry', async () => {
      const { chargeTypeIds } = await resolveRateReferences(bothBranchesActor, [], ['NOT_A_CHARGE'])
      expect(chargeTypeIds.size).toBe(0)
    })

    it('asks the database nothing when there is nothing to ask about', async () => {
      const resolved = await resolveRateReferences(bothBranchesActor, [], [])
      expect(resolved.locationIds.size).toBe(0)
      expect(resolved.chargeTypeIds.size).toBe(0)
    })

    it('finds a customer by code, case-insensitively', async () => {
      const byCode = await resolveCustomerCodes(bothBranchesActor, ['cust-fixture-home'])
      expect(byCode.get('CUST-FIXTURE-HOME')).toBeDefined()
    })

    it('returns an empty map for no codes at all', async () => {
      expect((await resolveCustomerCodes(bothBranchesActor, [])).size).toBe(0)
    })

    it('leaves a code it cannot find out of the map rather than guessing', async () => {
      const byCode = await resolveCustomerCodes(bothBranchesActor, ['NO-SUCH-CUSTOMER'])
      expect(byCode.has('NO-SUCH-CUSTOMER')).toBe(false)
    })
  })

  describe('the cutover joins', () => {
    /** Stored as written, not as typed — the column holds the canonical term. */
    it('returns the canonical Incoterm, whatever casing the sheet used', async () => {
      const { incoterms } = await resolveJobReferences(bothBranchesActor, [], ['fob'])
      expect(incoterms.get('FOB')).toBe('FOB')
    })

    it('resolves lanes and terms together', async () => {
      const resolved = await resolveJobReferences(bothBranchesActor, ['AEJEA'], ['CIF'])

      expect(resolved.locationIds.get('AEJEA')).toBeDefined()
      expect(resolved.incoterms.get('CIF')).toBe('CIF')
    })

    it('resolves neither when asked for neither', async () => {
      const resolved = await resolveJobReferences(bothBranchesActor, [], [])
      expect(resolved.locationIds.size).toBe(0)
      expect(resolved.incoterms.size).toBe(0)
    })

    it('gives a job reference back with the branch it belongs to', async () => {
      const found = await resolveJobsByReference(bothBranchesActor, ['fxh-job-fixture-1'])

      expect(found.get('FXH-JOB-FIXTURE-1')?.id).toBe(HOME_JOB)
      expect(found.get('FXH-JOB-FIXTURE-1')?.branchId).toBeDefined()
    })

    /**
     * Not an error. Plenty of open invoices at cutover relate to jobs already
     * closed in the old system, and refusing them would mean refusing the
     * balance — so an unmatched reference is simply absent.
     */
    it('omits a reference it cannot match rather than refusing the batch', async () => {
      const found = await resolveJobsByReference(bothBranchesActor, [
        'FXH-JOB-FIXTURE-1',
        'GONE-FROM-THE-OLD-SYSTEM',
      ])

      expect(found.size).toBe(1)
      expect(found.has('GONE-FROM-THE-OLD-SYSTEM')).toBe(false)
    })

    it('returns an empty map for no references at all', async () => {
      expect((await resolveJobsByReference(bothBranchesActor, [])).size).toBe(0)
    })

    /** Scoping, proved by putting a row the actor holds next to one they do not. */
    it('reads a shipment in the other branch the actor also holds', async () => {
      const found = await resolveJobsByReference(bothBranchesActor, ['FXA-JOB-FIXTURE-1'])
      expect(found.get('FXA-JOB-FIXTURE-1')?.id).toBe(AWAY_JOB)
    })
  })

  describe('the pickers behind the form', () => {
    it('offers the active branches to import into', async () => {
      const options = await importableBranches(bothBranchesActor)
      expect(options.map((branch) => branch.code)).toContain('FXH')
    })

    it('offers the active partners a tariff can belong to', async () => {
      const options = await ratePartners(bothBranchesActor)
      expect(options.map((partner) => partner.code)).toContain('AGT-FIXTURE')
    })
  })
})
