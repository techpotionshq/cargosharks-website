/**
 * A signed-in customer's view of their own shipment — QA P2-12.
 *
 * `trackOwnShipment` takes an id and no second identifier, so the only thing
 * standing between a customer and another company's shipment is the
 * `customer_contact` arm of the jobs policy, read under their own actor. That
 * is a claim about the database, so it is tested against one.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { assets, documentTypes, documents, jobs, systemActor, withActor } =
  await import('@qabandi/db')
const { AWAY_BRANCH, AWAY_CUSTOMER, AWAY_JOB, CUSTOMER, HOME_BRANCH, HOME_JOB, world } =
  await import('@/lib/testing/fixtures')
const { trackOwnShipment } = await import('./queries')

const contact = {
  principalId: '00000000-0000-7000-8000-0000000000e2',
  type: 'customer_contact' as const,
  branchIds: [],
  customerId: CUSTOMER,
  partnerId: null,
  ip: null,
}

const awayContact = {
  ...contact,
  principalId: '00000000-0000-7000-8000-0000000000e3',
  customerId: AWAY_CUSTOMER,
}

/**
 * A fresh job per run with one document of every kind the rule must tell
 * apart. Fresh because other suites add documents to `HOME_JOB`, and
 * "exactly these" cannot be asserted against a job that keeps growing.
 */
async function jobWithDocuments(branchId: string, customerId: string) {
  return withActor(systemActor(), async (tx) => {
    const tag = randomUUID().slice(0, 8)
    const [job] = await tx
      .insert(jobs)
      .values({
        reference: `TRK-${tag}`,
        branchId,
        customerId,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'in_transit',
      })
      .returning({ id: jobs.id })
    const typeOf = async (visible: boolean) => {
      const [type] = await tx
        .insert(documentTypes)
        .values({
          code: `TRK-${tag}-${visible ? 'v' : 'i'}`,
          nameEn: visible ? 'Tracking visible' : 'Tracking internal',
          nameAr: visible ? 'مستند ظاهر' : 'مستند داخلي',
          category: 'test',
          isCustomerVisible: visible,
        })
        .returning({ id: documentTypes.id })
      return type!.id
    }
    const visible = await typeOf(true)
    const internal = await typeOf(false)
    const add = async (name: string, typeId: string, released: boolean, version = 1) => {
      const [asset] = await tx
        .insert(assets)
        .values({
          branchId,
          storageKey: `memory:test/${tag}/${name}`,
          fileName: `${name}.pdf`,
          contentType: 'application/pdf',
          byteSize: 4096,
        })
        .returning({ id: assets.id })
      const [doc] = await tx
        .insert(documents)
        .values({
          jobId: job!.id,
          documentTypeId: typeId,
          assetId: asset!.id,
          version,
          releasedAt: released ? new Date() : null,
        })
        .returning({ id: documents.id })
      return doc!.id
    }
    const old = await add('old', visible, true, 1)
    const current = await add('current', visible, true, 2)
    await tx.update(documents).set({ supersededById: current }).where(eq(documents.id, old))
    await add('draft', visible, false, 3)
    await add('internal', internal, true, 1)
    return { jobId: job!.id, current }
  })
}

describe.skipIf(!enabled)('a customer tracking their own shipment', () => {
  beforeAll(async () => {
    await world()
  })

  it('opens their own shipment by id, with no second identifier', async () => {
    const result = await trackOwnShipment(contact, HOME_JOB)
    expect(result?.reference).toBe('FXH-JOB-FIXTURE-1')
  })

  it("finds nothing for another company's shipment", async () => {
    expect(await trackOwnShipment(contact, AWAY_JOB)).toBeUndefined()
  })

  /*
    NEW-3: the documents query inner-joined `assets`, which shows a customer
    contact nothing, so the portal never listed a released document.
  */
  it('lists exactly the released, current, customer-visible documents', async () => {
    const { jobId, current } = await jobWithDocuments(HOME_BRANCH, CUSTOMER)
    const result = await trackOwnShipment(contact, jobId)
    expect(result?.documents.map((d) => d.id)).toEqual([current])
    // The size comes from the asset row the contact cannot read.
    expect(result?.documents[0]?.sizeKb).toBeNull()
  })

  it('shows another customer none of them, and each only its own', async () => {
    const home = await jobWithDocuments(HOME_BRANCH, CUSTOMER)
    const away = await jobWithDocuments(AWAY_BRANCH, AWAY_CUSTOMER)
    expect(await trackOwnShipment(awayContact, home.jobId)).toBeUndefined()
    expect(await trackOwnShipment(contact, away.jobId)).toBeUndefined()
    const own = await trackOwnShipment(awayContact, away.jobId)
    expect(own?.documents.map((d) => d.id)).toEqual([away.current])
  })
})
