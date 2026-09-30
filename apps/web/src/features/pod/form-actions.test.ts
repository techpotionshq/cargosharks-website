/**
 * Capturing a delivery — the one mutation designed for a phone at a gate.
 *
 * Every property below follows from where it is used, and each would be wrong
 * anywhere else in the product:
 *
 * **Nothing optional blocks the capture.** The signature pad may produce
 * nothing usable, the photographs may fail on a bad connection, the device may
 * refuse a location. None of it stops the delivery being recorded, because the
 * alternative is a driver who abandons the form and reports it on WhatsApp —
 * and then there is no record at all.
 *
 * **A failed photograph is reported, not swallowed.** The delivery is written
 * either way and the action names what did not upload, so the gap is found at
 * a desk that afternoon rather than during a claim two months later.
 *
 * **A correction supersedes; it never edits.** The wrong name on a delivery
 * note is exactly the thing somebody will later need to prove was corrected
 * rather than always right — and both writes are in one transaction, because a
 * job whose only delivery record is retired reads as "never delivered".
 *
 * **The branch comes from the shipment, not the form.** A hidden input would
 * let a posted form file a photograph against a branch the principal happens
 * to hold but the shipment does not belong to.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { assets, jobs, podPhotos, proofOfDelivery, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { captureProofOfDelivery } = await import('./form-actions')

const systemActor = { ...bothBranchesActor, type: 'system' as const }

function sessionWith(permissions: readonly string[]) {
  return {
    actor: bothBranchesActor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Delivery Driver',
      nameAr: null,
      email: 'pod@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([
      [HOME_BRANCH, 'coordinator'],
      [AWAY_BRANCH, 'coordinator'],
    ]),
    requiresTwoFactor: false,
  }
}

let seq = 0
const RUN = Date.now().toString(36).toUpperCase()

/** A shipment of its own, so one capture cannot see another's. */
async function freshJob(branchId = HOME_BRANCH): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference: `POD-${RUN}-${seq}`,
        branchId,
        customerId: CUSTOMER,
        mode: 'land',
        tradeDirection: 'import',
        status: 'delivered',
      })
      .returning({ id: jobs.id })
    return row!.id
  })
}

/** The minimum that makes a delivery evidence: who signed, and when. */
const capture = (jobId: string, extra: Record<string, string> = {}): FormData => {
  const data = new FormData()
  data.set('jobId', jobId)
  data.set('deliveredAt', '2026-08-14T14:20')
  data.set('receivedByName', 'Ahmed Al-Failakawi')
  for (const [key, value] of Object.entries(extra)) data.set(key, value)
  return data
}

async function podFor(jobId: string) {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select()
      .from(proofOfDelivery)
      .where(eq(proofOfDelivery.jobId, jobId))
      .orderBy(desc(proofOfDelivery.createdAt))
      .limit(1),
  )
  return row
}

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe.skipIf(!enabled)('capturing a delivery', () => {
  const fetchMock = vi.fn()

  /**
   * The service, which owns the storage credentials `apps/web` never holds.
   *
   * A real `assets` row is written rather than a made-up id, because
   * `proof_of_delivery.signature_asset_id` and `pod_photos.asset_id` are
   * foreign keys — a stubbed id passes the action and fails at the insert,
   * which would test the stub instead of the code.
   */
  const uploadAccepted = async (branchId = HOME_BRANCH) => {
    const assetId = await withActor(systemActor, async (tx) => {
      const [row] = await tx
        .insert(assets)
        .values({
          branchId,
          storageKey: `test:pod/${RUN}-${(seq += 1)}`,
          fileName: 'upload.bin',
          contentType: 'image/png',
          byteSize: 12,
        })
        .returning({ id: assets.id })
      return row!.id
    })
    return { ok: true, status: 200, json: async () => ({ assetId }) }
  }

  beforeAll(async () => {
    await world()
    harness.session = sessionWith(['job.update'])
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('SERVICE_URL', 'http://service.test')
    vi.stubEnv('INTERNAL_API_SECRET', 'secret')
  })

  afterEach(() => {
    fetchMock.mockReset()
  })

  afterAll(() => {
    harness.session = null
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  describe('the record itself', () => {
    it('records who signed and when the cargo changed hands', async () => {
      const jobId = await freshJob()

      const state = await captureProofOfDelivery({}, capture(jobId))

      expect(state.errors).toBeUndefined()
      expect(state.message).toBeUndefined()
      const pod = await podFor(jobId)
      expect(pod?.receivedByName).toBe('Ahmed Al-Failakawi')
      expect(pod?.capturedById).toBe(PRINCIPAL)
    })

    /**
     * Backdating is legitimate and common: the delivery happened at the gate
     * at 14:20 and the form is submitted from the office at 16:05. What the
     * column must not become is `now()`, which replaces the fact with the
     * moment somebody typed it up.
     */
    it('keeps the stated delivery time rather than the moment it was typed', async () => {
      const jobId = await freshJob()
      await captureProofOfDelivery({}, capture(jobId, { deliveredAt: '2026-08-14T14:20' }))

      const pod = await podFor(jobId)
      expect(pod!.deliveredAt.toISOString()).toContain('2026-08-14')
      expect(pod!.deliveredAt.getTime()).toBeLessThan(Date.now())
    })

    it('records an identity document where the driver took one', async () => {
      const jobId = await freshJob()
      await captureProofOfDelivery({}, capture(jobId, { receivedByIdNumber: '284091700123' }))

      expect((await podFor(jobId))?.receivedByIdNumber).toBe('284091700123')
    })

    it('records where the phone said it was', async () => {
      const jobId = await freshJob()
      await captureProofOfDelivery(
        {},
        capture(jobId, { latitude: '29.3759', longitude: '47.9774', accuracyMetres: '12' }),
      )

      const pod = await podFor(jobId)
      expect(Number(pod?.latitude)).toBeCloseTo(29.3759, 4)
      expect(Number(pod?.longitude)).toBeCloseTo(47.9774, 4)
    })

    /** The device refusing a location is normal, and it is not a blocker. */
    it('records a delivery with no location at all', async () => {
      const jobId = await freshJob()
      const state = await captureProofOfDelivery({}, capture(jobId))

      expect(state.errors).toBeUndefined()
      expect((await podFor(jobId))?.latitude).toBeNull()
    })

    it('refuses half a location, which is not one', async () => {
      const jobId = await freshJob()
      const state = await captureProofOfDelivery({}, capture(jobId, { latitude: '29.3759' }))

      expect(state.errors?.latitude).toBeDefined()
      expect(await podFor(jobId)).toBeUndefined()
    })

    it('refuses a coordinate that is not a number', async () => {
      const jobId = await freshJob()
      const state = await captureProofOfDelivery(
        {},
        capture(jobId, { latitude: 'somewhere', longitude: 'else' }),
      )
      expect(state.errors?.latitude).toBeDefined()
    })

    it('asks who signed when nobody was named', async () => {
      const jobId = await freshJob()
      const state = await captureProofOfDelivery({}, capture(jobId, { receivedByName: 'A' }))
      expect(state.errors?.receivedByName).toBeDefined()
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      expect((await captureProofOfDelivery({}, new FormData())).errors).toBeDefined()
    })

    /** Not-found, not forbidden — and reported rather than thrown at a gate. */
    it('says the shipment could not be found rather than raising', async () => {
      const state = await captureProofOfDelivery(
        {},
        capture('00000000-0000-7000-8000-00000000fe01'),
      )
      expect(state.message).toBe('podValidation.shipmentNotFound')
    })

    it('refuses a caller who may not touch the shipment', async () => {
      harness.session = sessionWith([])
      try {
        await expect(captureProofOfDelivery({}, capture(await freshJob()))).rejects.toThrow(
          'job.update',
        )
      } finally {
        harness.session = sessionWith(['job.update'])
      }
    })
  })

  describe('exceptions', () => {
    it('records a short or damaged delivery with what was wrong', async () => {
      const jobId = await freshJob()

      const state = await captureProofOfDelivery(
        {},
        capture(jobId, { hasException: 'on', exceptionNotes: 'Two cartons crushed at the corner' }),
      )

      expect(state.errors).toBeUndefined()
      const pod = await podFor(jobId)
      expect(pod?.hasException).toBe(true)
      expect(pod?.exceptionNotes).toContain('crushed')
    })

    /**
     * The database says the same thing. Stated in the schema too, because a
     * constraint violation reaches the driver as "something went wrong" and
     * this reaches them as a field with a message under it.
     */
    it('insists an exception says what was wrong', async () => {
      const jobId = await freshJob()
      const state = await captureProofOfDelivery({}, capture(jobId, { hasException: 'on' }))

      expect(state.errors?.exceptionNotes).toBeDefined()
      expect(await podFor(jobId)).toBeUndefined()
    })

    it('takes a clean delivery with no notes at all', async () => {
      const jobId = await freshJob()
      const state = await captureProofOfDelivery({}, capture(jobId))

      expect(state.errors).toBeUndefined()
      expect((await podFor(jobId))?.hasException).toBe(false)
    })
  })

  describe('the signature and the photographs', () => {
    it('stores the signature through the service and links it', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue(await uploadAccepted())

      await captureProofOfDelivery({}, capture(jobId, { signature: PNG }))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect((await podFor(jobId))?.signatureAssetId).toBeTruthy()
    })

    /**
     * The branch is read off the shipment. A form claiming another one must
     * not be able to file the bytes against it.
     */
    it('files the upload against the shipment’s branch, not the form’s', async () => {
      const jobId = await freshJob(AWAY_BRANCH)
      fetchMock.mockResolvedValue(await uploadAccepted(AWAY_BRANCH))

      await captureProofOfDelivery({}, capture(jobId, { signature: PNG, branchId: HOME_BRANCH }))

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
      expect(body.branchId).toBe(AWAY_BRANCH)
    })

    /**
     * A pad that produced nothing usable is a missing signature, which the
     * record allows — not an error worth failing a delivery over.
     */
    it('treats an unusable signature as no signature, and uploads nothing', async () => {
      const jobId = await freshJob()

      const state = await captureProofOfDelivery({}, capture(jobId, { signature: 'scribble' }))

      expect(state.message).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
      expect((await podFor(jobId))?.signatureAssetId).toBeNull()
    })

    it('stores the photographs in the order they were taken', async () => {
      const jobId = await freshJob()
      fetchMock.mockImplementation(() => uploadAccepted())

      const data = capture(jobId)
      data.append('photos', new File([Buffer.from('one')], 'gate.jpg', { type: 'image/jpeg' }))
      data.append('photos', new File([Buffer.from('two')], 'seal.jpg', { type: 'image/jpeg' }))
      await captureProofOfDelivery({}, data)

      const pod = await podFor(jobId)
      const photos = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ sortOrder: podPhotos.sortOrder })
          .from(podPhotos)
          .where(eq(podPhotos.podId, pod!.id))
          .orderBy(podPhotos.sortOrder),
      )
      expect(photos.map((photo) => photo.sortOrder)).toEqual([0, 1])
    })

    it('ignores an empty file input', async () => {
      const jobId = await freshJob()

      const data = capture(jobId)
      data.append('photos', new File([], 'nothing.jpg', { type: 'image/jpeg' }))
      const state = await captureProofOfDelivery({}, data)

      expect(state.errors).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    /**
     * The delivery is the fact worth keeping and it is written either way.
     * Saying nothing about the photographs that did not upload would leave a
     * gap discovered during a claim — the worst possible moment.
     */
    it('records the delivery and names what did not upload', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

      const data = capture(jobId, { signature: PNG })
      data.append('photos', new File([Buffer.from('x')], 'gate.jpg', { type: 'image/jpeg' }))
      const state = await captureProofOfDelivery({}, data)

      expect(state.message).toContain('podValidation.uploadsFailed')
      expect(state.message).toContain('podValidation.uploadSignature')
      expect(state.message).toContain('gate.jpg')
      // Written regardless — that is the whole point.
      expect(await podFor(jobId)).toBeDefined()
    })

    it('records the delivery when the storage is not configured at all', async () => {
      const jobId = await freshJob()
      vi.stubEnv('SERVICE_URL', '')
      try {
        const state = await captureProofOfDelivery({}, capture(jobId, { signature: PNG }))

        expect(state.message).toContain('podValidation.uploadsFailed')
        expect(await podFor(jobId)).toBeDefined()
      } finally {
        vi.stubEnv('SERVICE_URL', 'http://service.test')
      }
    })

    it('reports a service that accepted the bytes but named no asset', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

      const state = await captureProofOfDelivery({}, capture(jobId, { signature: PNG }))

      expect(state.message).toContain('podValidation.uploadSignature')
      expect(await podFor(jobId)).toBeDefined()
    })
  })

  describe('correcting one', () => {
    /**
     * Supersede, never edit. Both writes are in one transaction: marking the
     * old row first and failing on the new one would leave a shipment whose
     * only delivery record is retired, which reads as "never delivered" on the
     * customer portal.
     */
    it('retires the earlier capture and keeps it', async () => {
      const jobId = await freshJob()
      await captureProofOfDelivery({}, capture(jobId, { receivedByName: 'Wrong Name Written' }))
      const first = await podFor(jobId)

      await captureProofOfDelivery(
        {},
        capture(jobId, { receivedByName: 'Correct Name', supersedesId: first!.id }),
      )

      const rows = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            id: proofOfDelivery.id,
            receivedByName: proofOfDelivery.receivedByName,
            supersededById: proofOfDelivery.supersededById,
          })
          .from(proofOfDelivery)
          .where(eq(proofOfDelivery.jobId, jobId)),
      )

      // Both rows survive: the correction is provable, not invisible.
      expect(rows).toHaveLength(2)
      const retired = rows.find((row) => row.id === first!.id)
      const current = rows.find((row) => row.id !== first!.id)
      expect(retired?.receivedByName).toBe('Wrong Name Written')
      expect(retired?.supersededById).toBe(current!.id)
      expect(current?.supersededById).toBeNull()
    })

    it('refuses a supersedes that is not an identifier', async () => {
      const jobId = await freshJob()
      const state = await captureProofOfDelivery(
        {},
        capture(jobId, { supersedesId: 'the-old-one' }),
      )
      expect(state.errors).toBeDefined()
    })
  })
})
