/**
 * The automation-activity strip — what the machine did to one enquiry.
 *
 * The read is a set of counts a coordinator turns into one line: acknowledged,
 * N fields read, N rate requests out, M replied. Every count is a `where` and a
 * filter, and a `where` is exactly what a mocked test cannot check — so this
 * runs the real read against real rows and asserts the four numbers move
 * independently. It also covers the pilot branch, because the strip is on the
 * hosted demo and a fixture that returned zeros would show the machine idle on
 * a board built to show it working.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

// Flipped per-test: the DB branch needs it off, one test needs it on.
const pilot = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => pilot.on }))

const {
  aiInvocations,
  enquiries,
  extractionProposals,
  notificationOutbox,
  rateRequests,
  withActor,
} = await import('@qabandi/db')
const { world, bothBranchesActor, HOME_BRANCH, CUSTOMER, PARTNER } =
  await import('@/lib/testing/fixtures')
const { enquiryAutomation } = await import('./automation')

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

const system = { ...bothBranchesActor, type: 'system' as const }

/** Every proposal cites the invocation that produced it — the column is not null. */
let invocationId: string
async function anInvocation(): Promise<string> {
  return withActor(system, async (tx) => {
    const [row] = await tx
      .insert(aiInvocations)
      .values({
        branchId: HOME_BRANCH,
        principalId: bothBranchesActor.principalId,
        surface: 'enquiry_extract',
        modelRequested: 'test-model',
        promptVersion: 'test',
        inputHash: `auto-${RUN}`,
      })
      .returning({ id: aiInvocations.id })
    return row!.id
  })
}

async function makeEnquiry(): Promise<string> {
  seq += 1
  return withActor(system, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `FXH-AUTO-${RUN}-${seq}`,
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        status: 'new',
        channel: 'email',
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

async function acknowledge(enquiryId: string): Promise<void> {
  await withActor(system, (tx) =>
    tx.insert(notificationOutbox).values({
      branchId: HOME_BRANCH,
      eventKey: 'enquiry.received',
      enquiryId,
      customerId: CUSTOMER,
      payload: { reference: 'ack' },
    }),
  )
}

async function proposal(enquiryId: string, field: string, status: 'proposed' | 'applied') {
  // An `applied` proposal must say who decided it — `extraction_proposals_decision_attributed`.
  const decided =
    status === 'applied'
      ? {
          decidedById: bothBranchesActor.principalId,
          decidedAt: new Date(),
          closedAt: new Date(),
        }
      : {}
  await withActor(system, (tx) =>
    tx.insert(extractionProposals).values({
      branchId: HOME_BRANCH,
      invocationId,
      targetTable: 'enquiries',
      targetId: enquiryId,
      field,
      value: 'x',
      status,
      ...decided,
    }),
  )
}

async function rfq(enquiryId: string, status: 'sent' | 'responded' | 'parsed' | 'superseded') {
  seq += 1
  await withActor(system, (tx) =>
    tx.insert(rateRequests).values({
      branchId: HOME_BRANCH,
      enquiryId,
      partnerId: PARTNER,
      status,
      token: `auto-${RUN}-${seq}`,
    }),
  )
}

describe.skipIf(!enabled)('enquiryAutomation', () => {
  beforeAll(async () => {
    await world()
    invocationId = await anInvocation()
  })

  afterEach(() => {
    pilot.on = false
  })

  it('reports nothing on an enquiry the machine has not touched', async () => {
    const id = await makeEnquiry()

    const activity = await enquiryAutomation(bothBranchesActor, id)

    expect(activity).toEqual({
      acknowledgedAt: null,
      fieldsRead: 0,
      fieldsPending: 0,
      rateRequestsSent: 0,
      rateRepliesIn: 0,
    })
  })

  it('reports the acknowledgement once the customer was told', async () => {
    const id = await makeEnquiry()
    await acknowledge(id)

    const activity = await enquiryAutomation(bothBranchesActor, id)

    expect(activity.acknowledgedAt).toBeInstanceOf(Date)
  })

  /** Read is every proposal ever made; pending is the ones still `proposed`. */
  it('counts fields read apart from fields still waiting', async () => {
    const id = await makeEnquiry()
    await proposal(id, 'incoterm', 'proposed')
    await proposal(id, 'mode', 'proposed')
    await proposal(id, 'origin', 'applied')

    const activity = await enquiryAutomation(bothBranchesActor, id)

    expect(activity.fieldsRead).toBe(3)
    expect(activity.fieldsPending).toBe(2)
  })

  /**
   * Sent counts every request that is not superseded; replied counts the ones
   * an agent has answered. A superseded request is a re-ask and must not
   * inflate either number.
   */
  it('counts rate requests sent apart from the ones answered', async () => {
    const id = await makeEnquiry()
    await rfq(id, 'sent')
    await rfq(id, 'responded')
    await rfq(id, 'parsed')
    await rfq(id, 'superseded')

    const activity = await enquiryAutomation(bothBranchesActor, id)

    expect(activity.rateRequestsSent).toBe(3)
    expect(activity.rateRepliesIn).toBe(2)
  })

  /** Each enquiry sees only its own activity, not the board's. */
  it('does not count another enquiry’s activity', async () => {
    const mine = await makeEnquiry()
    const other = await makeEnquiry()
    await proposal(other, 'incoterm', 'proposed')
    await rfq(other, 'responded')

    const activity = await enquiryAutomation(bothBranchesActor, mine)

    expect(activity.fieldsRead).toBe(0)
    expect(activity.rateRequestsSent).toBe(0)
  })

  /** The hosted demo shows the strip mid-workflow, not idle. */
  it('returns the mid-automation fixture in pilot mode', async () => {
    pilot.on = true

    const activity = await enquiryAutomation(bothBranchesActor, 'any-id')

    expect(activity.acknowledgedAt).toBeInstanceOf(Date)
    expect(activity.fieldsRead).toBeGreaterThan(0)
    expect(activity.rateRequestsSent).toBeGreaterThan(0)
    expect(activity.rateRepliesIn).toBeGreaterThan(0)
  })
})
