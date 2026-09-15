/**
 * The parties and the places — reference-shaped data, created rarely and read
 * constantly.
 *
 * Two decisions differ from the transactional slices and both are asserted
 * here rather than assumed:
 *
 * **Nothing is deleted.** A partner named on a two-year-old job file cannot be
 * removed without taking the job's history with it, so `isActive` is the only
 * retirement there is (§5.5, FR-ID-09). The dialog says "stop using" because
 * that is what happens.
 *
 * **The code is the human key.** It is read down a phone, typed into a search
 * box and printed on a quotation, so it is uppercased and constrained rather
 * than free text — and the SCAC is uppercased *before* it is measured, because
 * an operator types `maeu` and the carrier gateways answer only to `MAEU`.
 * Normalising on the way in is what keeps the poll worker's lookup a plain
 * equality instead of a function call on a column.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { locations, partners, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { savePartner, saveLocation, setNetworkActive } = await import('./form-actions')

function sessionWith(permissions: readonly string[]) {
  return {
    actor: bothBranchesActor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Network Administrator',
      nameAr: null,
      email: 'network@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([
      [HOME_BRANCH, 'operations_manager'],
      [AWAY_BRANCH, 'operations_manager'],
    ]),
    requiresTwoFactor: false,
  }
}

const ALL = ['partner.write', 'admin.reference.write']

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
const code = (prefix: string) => `${prefix}${RUN}${(seq += 1)}`

const partnerForm = (extra: Record<string, string> = {}) =>
  form({
    code: code('PN'),
    type: 'agent',
    legalNameEn: 'Network Test Agency',
    isActive: 'on',
    ...extra,
  })

const placeForm = (extra: Record<string, string> = {}) =>
  form({
    nameEn: 'Network Test Place',
    countryCode: 'KW',
    kind: 'inland',
    isActive: 'on',
    ...extra,
  })

const partnerByCode = async (value: string) => {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx.select().from(partners).where(eq(partners.code, value)),
  )
  return row
}

describe.skipIf(!enabled)('the network', () => {
  beforeAll(async () => {
    await world()
    harness.session = sessionWith(ALL)
  })

  afterAll(() => {
    harness.session = null
  })

  describe('partners', () => {
    it('records an agent', async () => {
      const value = code('AG')
      const state = await savePartner({}, partnerForm({ code: value, type: 'agent' }))

      expect(state.errors).toBeUndefined()
      const row = await partnerByCode(value)
      expect(row?.type).toBe('agent')
      expect(row?.isActive).toBe(true)
    })

    /** Read down a phone and typed into a search box — so never mixed case. */
    it('uppercases the code whatever was typed', async () => {
      const value = code('LC')
      await savePartner({}, partnerForm({ code: value.toLowerCase() }))

      expect(await partnerByCode(value)).toBeDefined()
    })

    /**
     * The reason the carrier feed can find this partner at all: the gateways
     * answer only to `MAEU`, and normalising here keeps the poll worker's
     * lookup a plain equality rather than `upper()` on a column.
     */
    it('uppercases the SCAC before it measures it', async () => {
      const value = code('CR')
      const state = await savePartner(
        {},
        partnerForm({ code: value, type: 'carrier', scac: 'maeu' }),
      )

      expect(state.errors).toBeUndefined()
      expect((await partnerByCode(value))?.scac).toBe('MAEU')
    })

    it('refuses a SCAC that is not four characters', async () => {
      const state = await savePartner({}, partnerForm({ type: 'carrier', scac: 'MAE' }))
      expect(state.errors?.scac).toBeDefined()
    })

    it('records the country and currency in upper case', async () => {
      const value = code('CU')
      await savePartner({}, partnerForm({ code: value, countryCode: 'ae', currency: 'usd' }))

      const row = await partnerByCode(value)
      expect(row?.countryCode).toBe('AE')
      expect(row?.currency).toBe('USD')
    })

    it('records payment terms in days', async () => {
      const value = code('PT')
      await savePartner({}, partnerForm({ code: value, paymentTermsDays: '45' }))
      expect((await partnerByCode(value))?.paymentTermsDays).toBe(45)
    })

    it('edits the partner it was given rather than adding another', async () => {
      const value = code('ED')
      await savePartner({}, partnerForm({ code: value, legalNameEn: 'Before Rename' }))
      const existing = await partnerByCode(value)

      await savePartner(
        {},
        partnerForm({ partnerId: existing!.id, code: value, legalNameEn: 'After Rename' }),
      )

      const rows = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: partners.id }).from(partners).where(eq(partners.code, value)),
      )
      expect(rows).toHaveLength(1)
      expect((await partnerByCode(value))?.legalNameEn).toBe('After Rename')
    })

    /**
     * Caught rather than pre-checked: a select before an insert is a race the
     * database is already handling correctly.
     */
    it('reports a duplicate code on the field rather than raising', async () => {
      const value = code('DU')
      await savePartner({}, partnerForm({ code: value }))

      const again = await savePartner({}, partnerForm({ code: value }))

      expect(again.errors?.code).toContain('already in use')
    })

    it('refuses a code with a space in it', async () => {
      expect((await savePartner({}, partnerForm({ code: 'AG ENT' }))).errors?.code).toBeDefined()
    })

    it('refuses a type the platform does not model', async () => {
      expect(
        (await savePartner({}, partnerForm({ type: 'consultant' }))).errors?.type,
      ).toBeDefined()
    })

    it('insists on a legal name', async () => {
      expect(
        (await savePartner({}, partnerForm({ legalNameEn: 'X' }))).errors?.legalNameEn,
      ).toBeDefined()
    })

    /** An unchecked box arrives absent, not as `false`. */
    it('reads an absent active box as retired', async () => {
      const value = code('IN')
      const data = partnerForm({ code: value })
      data.delete('isActive')
      await savePartner({}, data)

      expect((await partnerByCode(value))?.isActive).toBe(false)
    })

    it('refuses a caller who may not write partners', async () => {
      harness.session = sessionWith(['admin.reference.write'])
      try {
        await expect(savePartner({}, partnerForm())).rejects.toThrow('partner.write')
      } finally {
        harness.session = sessionWith(ALL)
      }
    })
  })

  describe('places', () => {
    it('records a port with its UN/LOCODE', async () => {
      /*
        Three characters of entropy is all a UN/LOCODE leaves, and nothing is
        ever deleted — so the low base-36 digits of the clock, which turn over
        every millisecond, rather than anything derived from the run counter.
      */
      const unlocode = `KW${Date.now().toString(36).toUpperCase().slice(-3)}`
      const state = await saveLocation(
        {},
        placeForm({ unlocode, nameEn: 'Test Port', kind: 'seaport' }),
      )

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select().from(locations).where(eq(locations.unlocode, unlocode)),
      )
      expect(row?.kind).toBe('seaport')
      expect(row?.countryCode).toBe('KW')
    })

    /**
     * Optional, and that is the point: an inland depot or a customer's own
     * yard has no code, and refusing to record one until somebody invents a
     * code is how a place ends up typed as free text into a notes field.
     */
    it('records a yard that has no code at all', async () => {
      const state = await saveLocation({}, placeForm({ nameEn: 'Customer Yard, Sulaibiya' }))

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ unlocode: locations.unlocode })
          .from(locations)
          .where(eq(locations.nameEn, 'Customer Yard, Sulaibiya'))
          .limit(1),
      )
      expect(row?.unlocode).toBeNull()
    })

    it('refuses a UN/LOCODE that is not one', async () => {
      const state = await saveLocation({}, placeForm({ unlocode: 'SHUWAIKH' }))
      expect(state.errors?.unlocode).toBeDefined()
    })

    /**
     * Records its own port first, then collides with it.
     *
     * The first version collided with the seed's `KWSWK` — and on a database
     * where this suite ran *before* `db:seed-demo`, there was no such row, the
     * save succeeded, and "Shuwaikh Two" (an inland depot with no Arabic name)
     * became the deployment's Shuwaikh for good: the seed found the code taken
     * and did nothing, and a service-side document test later failed on a port
     * with no Arabic name. A test that depends on what ran before it is a test
     * that poisons a fresh database, so this one makes the row it needs.
     */
    it('reports a UN/LOCODE already recorded rather than raising', async () => {
      const unlocode = `KW${(Date.now() + 1).toString(36).toUpperCase().slice(-3)}`
      const first = await saveLocation(
        {},
        placeForm({ unlocode, nameEn: 'First Port', kind: 'seaport' }),
      )
      expect(first.errors).toBeUndefined()

      const second = await saveLocation(
        {},
        placeForm({ unlocode, nameEn: 'Second Port', kind: 'seaport' }),
      )
      expect(second.errors?.unlocode).toContain('already recorded')
    })

    it('insists on a country', async () => {
      const state = await saveLocation({}, placeForm({ countryCode: '' }))
      expect(state.errors?.countryCode).toBeDefined()
    })

    it('refuses a kind of place it does not model', async () => {
      expect((await saveLocation({}, placeForm({ kind: 'spaceport' }))).errors?.kind).toBeDefined()
    })

    it('edits the place it was given rather than adding another', async () => {
      await saveLocation({}, placeForm({ nameEn: `Place ${RUN} Before` }))
      const [existing] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.nameEn, `Place ${RUN} Before`)),
      )

      await saveLocation({}, placeForm({ locationId: existing!.id, nameEn: `Place ${RUN} After` }))

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ nameEn: locations.nameEn })
          .from(locations)
          .where(eq(locations.id, existing!.id)),
      )
      expect(row?.nameEn).toBe(`Place ${RUN} After`)
    })

    /** Places are reference data, behind the same gate as charge types. */
    it('refuses a caller without the reference permission', async () => {
      harness.session = sessionWith(['partner.write'])
      try {
        await expect(saveLocation({}, placeForm())).rejects.toThrow('admin.reference.write')
      } finally {
        harness.session = sessionWith(ALL)
      }
    })
  })

  describe('retiring rather than deleting — FR-ID-09', () => {
    it('stops a partner being used, and keeps the row', async () => {
      const value = code('RT')
      await savePartner({}, partnerForm({ code: value }))
      const existing = await partnerByCode(value)

      // The active box is absent, which is how an unchecked checkbox arrives.
      const state = await setNetworkActive({}, form({ kind: 'partner', id: existing!.id }))

      expect(state.errors).toBeUndefined()
      const after = await partnerByCode(value)
      expect(after).toBeDefined()
      expect(after!.isActive).toBe(false)
    })

    it('brings one back', async () => {
      const value = code('RB')
      await savePartner({}, partnerForm({ code: value }))
      const existing = await partnerByCode(value)

      await setNetworkActive({}, form({ kind: 'partner', id: existing!.id }))
      await setNetworkActive({}, form({ kind: 'partner', id: existing!.id, isActive: 'on' }))

      expect((await partnerByCode(value))?.isActive).toBe(true)
    })

    it('retires a place through the same action', async () => {
      await saveLocation({}, placeForm({ nameEn: `Retire ${RUN}` }))
      const [existing] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.nameEn, `Retire ${RUN}`)),
      )

      await setNetworkActive({}, form({ kind: 'location', id: existing!.id }))

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ isActive: locations.isActive })
          .from(locations)
          .where(eq(locations.id, existing!.id)),
      )
      expect(row?.isActive).toBe(false)
    })

    it('says so plainly when it was given nothing to update', async () => {
      expect((await setNetworkActive({}, form({}))).errors).toBeDefined()
    })

    it('refuses a kind of record it does not know', async () => {
      const state = await setNetworkActive(
        {},
        form({ kind: 'customer', id: '00000000-0000-7000-8000-0000000000aa' }),
      )
      expect(state.errors).toBeDefined()
    })

    /** The gate follows the record: places are reference data, partners are not. */
    it('checks the permission that matches the record', async () => {
      const value = code('PM')
      await savePartner({}, partnerForm({ code: value }))
      const existing = await partnerByCode(value)

      harness.session = sessionWith(['admin.reference.write'])
      try {
        await expect(
          setNetworkActive({}, form({ kind: 'partner', id: existing!.id })),
        ).rejects.toThrow('partner.write')
      } finally {
        harness.session = sessionWith(ALL)
      }
    })
  })
})
