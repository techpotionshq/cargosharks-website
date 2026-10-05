/**
 * Vessel positions under row-level security — `0069_vessel_positions_policy`.
 *
 * The table is a `systemTable` (no audit trigger, for the reason in its schema
 * file), so the registry-walking tests in `rls.test.ts` do not reach it. This
 * file states its policy directly: a vessel is visible exactly when a job
 * sailing on it is, and only the system actor writes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  branches,
  createDatabase,
  customers,
  jobPartners,
  jobs,
  openSeaVesselMmsis,
  partners,
  recordVesselReports,
  setJobVesselIdentity,
  systemActor,
  vesselForJob,
  vesselPositions,
  withActor,
  workingCalendars,
  type Actor,
  type Database,
  type VesselReport,
} from '../src/index'

const APP_URL = process.env.TEST_DATABASE_URL
const MIGRATOR_URL = process.env.TEST_MIGRATION_DATABASE_URL
const enabled = Boolean(APP_URL && MIGRATOR_URL)

// Distinct from rls.test.ts and rls-matrix.test.ts so the suites can share a database.
const KUWAIT = '00000000-0000-7000-8000-0000000007b1'
const DUBAI = '00000000-0000-7000-8000-0000000007b2'
const CUSTOMER_A = '00000000-0000-7000-8000-0000000007c1'
const CUSTOMER_B = '00000000-0000-7000-8000-0000000007c2'
const PARTNER_P = '00000000-0000-7000-8000-0000000007d1'
const JOB_A = '00000000-0000-7000-8000-0000000007e1'
const JOB_B = '00000000-0000-7000-8000-0000000007e2'
const JOB_NAMED = '00000000-0000-7000-8000-0000000007e3'
const MMSI_A = '477000101'
const MMSI_B = '244000202'

const kuwaitStaff: Actor = {
  principalId: '00000000-0000-7000-8000-0000000007a1',
  type: 'internal',
  branchIds: [KUWAIT],
}
const customerAContact: Actor = {
  principalId: '00000000-0000-7000-8000-0000000007a3',
  type: 'customer_contact',
  branchIds: [],
  customerId: CUSTOMER_A,
}
const customerBContact: Actor = {
  principalId: '00000000-0000-7000-8000-0000000007a5',
  type: 'customer_contact',
  branchIds: [],
  customerId: CUSTOMER_B,
}
const agentContact: Actor = {
  principalId: '00000000-0000-7000-8000-0000000007a4',
  type: 'agent_contact',
  branchIds: [],
  partnerId: PARTNER_P,
}

const at = (iso: string) => new Date(iso)

function position(mmsi: string, positionAt: string, lat = 31.2, lon = 121.6): VesselReport {
  return {
    kind: 'position',
    mmsi,
    source: 'aisstream',
    latitude: lat,
    longitude: lon,
    speedKnots: 12.4,
    courseDegrees: 210,
    headingDegrees: 211,
    navStatus: 0,
    positionAt: at(positionAt),
    receivedAt: at(positionAt),
  }
}

describe.skipIf(!enabled)('vessel positions', () => {
  let app: Database
  let migrator: Database

  beforeAll(async () => {
    app = createDatabase({ connectionString: APP_URL!, max: 2 })
    migrator = createDatabase({ connectionString: MIGRATOR_URL!, max: 1 })

    await withActor(
      systemActor(),
      async (tx) => {
        const [calendar] = await tx
          .select({ id: workingCalendars.id })
          .from(workingCalendars)
          .where(eq(workingCalendars.key, 'kuwait'))
          .limit(1)
        if (!calendar) throw new Error('Run `pnpm db:seed` before the database tests')

        await tx
          .insert(branches)
          .values([
            {
              id: KUWAIT,
              code: 'VKW',
              legalNameEn: 'Vessel test Kuwait',
              legalNameAr: 'اختبار السفن الكويت',
              country: 'KW',
              baseCurrency: 'KWD',
              invoiceSeries: 'VKW',
              calendarId: calendar.id,
            },
            {
              id: DUBAI,
              code: 'VDX',
              legalNameEn: 'Vessel test Dubai',
              legalNameAr: 'اختبار السفن دبي',
              country: 'AE',
              baseCurrency: 'AED',
              invoiceSeries: 'VDX',
              calendarId: calendar.id,
            },
          ])
          .onConflictDoNothing()
        await tx
          .insert(customers)
          .values([
            { id: CUSTOMER_A, code: 'VCUST-A', legalNameEn: 'Vessel customer A' },
            { id: CUSTOMER_B, code: 'VCUST-B', legalNameEn: 'Vessel customer B' },
          ])
          .onConflictDoNothing()
        await tx
          .insert(partners)
          .values([{ id: PARTNER_P, code: 'VAGT-P', type: 'agent', legalNameEn: 'Vessel agent' }])
          .onConflictDoNothing()
        await tx
          .insert(jobs)
          .values([
            {
              id: JOB_A,
              reference: 'VKW-VESSEL-TEST-1',
              branchId: KUWAIT,
              customerId: CUSTOMER_A,
              mode: 'sea_fcl',
              tradeDirection: 'import',
              status: 'in_transit',
              vesselName: 'TEST TRADER',
              vesselMmsi: MMSI_A,
            },
            {
              id: JOB_B,
              reference: 'VDX-VESSEL-TEST-2',
              branchId: DUBAI,
              customerId: CUSTOMER_B,
              mode: 'sea_lcl',
              tradeDirection: 'import',
              status: 'booked',
              vesselMmsi: MMSI_B,
            },
            {
              id: JOB_NAMED,
              reference: 'VKW-VESSEL-TEST-3',
              branchId: KUWAIT,
              customerId: CUSTOMER_A,
              mode: 'sea_fcl',
              tradeDirection: 'import',
              status: 'booked',
              vesselName: 'mv  Test Trader',
            },
          ])
          .onConflictDoNothing()
        await tx
          .insert(jobPartners)
          .values([{ jobId: JOB_A, branchId: KUWAIT, partnerId: PARTNER_P, role: 'origin_agent' }])
          .onConflictDoNothing()

        await recordVesselReports(tx, [
          position(MMSI_A, '2026-10-05T08:00:00Z'),
          position(MMSI_B, '2026-10-05T08:00:00Z', 51.95, 4.05),
          {
            kind: 'static',
            mmsi: MMSI_A,
            source: 'aisstream',
            imo: '9074729',
            name: 'TEST TRADER',
            callSign: 'TEST1',
            shipType: 70,
            reportedDestination: 'KWSWK',
            reportedEta: at('2026-10-20T06:00:00Z'),
            receivedAt: at('2026-10-05T08:01:00Z'),
          },
        ])
      },
      app,
    )
  })

  afterAll(async () => {
    await app?.$client.end()
    await migrator?.$client.end()
  })

  const visibleMmsis = (actor: Actor) =>
    withActor(
      actor,
      async (tx) =>
        (
          await tx
            .select({ mmsi: vesselPositions.mmsi })
            .from(vesselPositions)
            .where(sql`${vesselPositions.mmsi} in (${MMSI_A}, ${MMSI_B})`)
        )
          .map((r) => r.mmsi)
          .sort(),
      app,
    )

  it('enables and forces RLS on the table', async () => {
    const result = await migrator.execute(sql`
      select relrowsecurity, relforcerowsecurity from pg_class where relname = 'vessel_positions'
    `)
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
  })

  it('shows a vessel to staff, the customer and the agent of a job on it, and nobody else', async () => {
    expect(await visibleMmsis(kuwaitStaff)).toEqual([MMSI_A])
    expect(await visibleMmsis(customerAContact)).toEqual([MMSI_A])
    expect(await visibleMmsis(customerBContact)).toEqual([MMSI_B])
    expect(await visibleMmsis(agentContact)).toEqual([MMSI_A])
  })

  it('refuses a write from anyone but the system actor', async () => {
    await expect(
      withActor(
        kuwaitStaff,
        (tx) => tx.insert(vesselPositions).values({ mmsi: '538000303', source: 'typed' }),
        app,
      ),
    ).rejects.toThrow()
    const updated = await withActor(
      kuwaitStaff,
      (tx) =>
        tx
          .update(vesselPositions)
          .set({ latitude: 0 })
          .where(eq(vesselPositions.mmsi, MMSI_A))
          .returning({ id: vesselPositions.id }),
      app,
    )
    expect(updated).toEqual([])
  })

  it('keeps the newest fix, learns identity from static data, and never moves backwards', async () => {
    await withActor(
      systemActor(),
      (tx) => recordVesselReports(tx, [position(MMSI_A, '2026-10-05T07:00:00Z', 1, 1)]),
      app,
    )
    const vessel = await withActor(customerAContact, (tx) => vesselForJob(tx, JOB_A), app)
    expect(vessel?.position?.latitude).toBe(31.2)
    expect(vessel?.position?.imo).toBe('9074729')
    expect(vessel?.position?.reportedDestination).toBe('KWSWK')
    expect(vessel?.position?.track).toHaveLength(1)
  })

  it('subscribes only to MMSIs on open sea jobs', async () => {
    const mmsis = await withActor(systemActor(), (tx) => openSeaVesselMmsis(tx), app)
    expect(mmsis).toEqual(expect.arrayContaining([MMSI_A, MMSI_B]))
  })

  it('offers a name match as a suggestion only, and refuses a malformed MMSI', async () => {
    const vessel = await withActor(kuwaitStaff, (tx) => vesselForJob(tx, JOB_NAMED), app)
    expect(vessel?.mmsi).toBeNull()
    expect(vessel?.position).toBeNull()
    expect(vessel?.suggestion).toEqual({
      mmsi: MMSI_A,
      imo: '9074729',
      name: 'TEST TRADER',
      basis: 'name',
    })

    await expect(
      withActor(
        systemActor(),
        (tx) => tx.update(jobs).set({ vesselMmsi: '123' }).where(eq(jobs.id, JOB_NAMED)),
        app,
      ),
    ).rejects.toThrow()

    // Normalised on the way in: an invalid MMSI is stored as nothing, not as typed.
    await withActor(
      kuwaitStaff,
      (tx) => setJobVesselIdentity(tx, JOB_NAMED, { imo: 'IMO 9074729', mmsi: 'not one' }),
      app,
    )
    const after = await withActor(kuwaitStaff, (tx) => vesselForJob(tx, JOB_NAMED), app)
    expect(after?.imo).toBe('9074729')
    expect(after?.mmsi).toBeNull()
  })
})
