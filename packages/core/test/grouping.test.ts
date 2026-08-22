import { describe, expect, it } from 'vitest'
import {
  CONTAINER_CAPACITIES,
  clusterShipments,
  fitFor,
  type GroupableShipment,
} from '../src/grouping'

/**
 * The groupage question asked before the consolidation exists.
 *
 * What is pinned here is mostly refusal, because a wrong grouping is worse
 * than no grouping: it puts one customer's cargo on a sailing chosen for
 * somebody else's timing, and the coordinator who accepted the suggestion has
 * no record of why it looked right.
 */

const SHANGHAI = 'loc-shanghai'
const SHUWAIKH = 'loc-shuwaikh'
const JEBEL_ALI = 'loc-jebel-ali'
const KUWAIT = 'branch-kuwait'
const DUBAI = 'branch-dubai'

let counter = 0

const shipment = (over: Partial<GroupableShipment> = {}): GroupableShipment => {
  counter += 1
  return {
    jobId: `job-${counter}`,
    reference: `KWI-JOB-2026-${String(counter).padStart(5, '0')}`,
    branchId: KUWAIT,
    customerId: `cust-${counter}`,
    customerName: `Customer ${counter}`,
    mode: 'sea_lcl',
    originId: SHANGHAI,
    destinationId: SHUWAIKH,
    originName: 'Shanghai',
    destinationName: 'Shuwaikh',
    readyOn: new Date('2026-09-01T00:00:00Z'),
    volumeCbm: 12,
    grossWeightKg: 3000,
    pieces: 40,
    ...over,
  }
}

describe('clustering loose shipments', () => {
  it('groups shipments sharing a lane, a mode and a week', () => {
    const clusters = clusterShipments([
      shipment(),
      shipment({ readyOn: new Date('2026-09-03T00:00:00Z') }),
      shipment({ readyOn: new Date('2026-09-05T00:00:00Z') }),
    ])

    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.shipments).toHaveLength(3)
    expect(clusters[0]?.totalCbm).toBe(36)
    expect(clusters[0]?.totalKg).toBe(9000)
    expect(clusters[0]?.totalPieces).toBe(120)
    expect(clusters[0]?.customerCount).toBe(3)
  })

  /**
   * A lane is an exact pair of rows, never a region.
   *
   * Jebel Ali and Shuwaikh are both "the Gulf" and a shipment sent to the
   * wrong one arrives at a terminal the consignee has no arrangement with.
   */
  it('does not group two different destinations', () => {
    const clusters = clusterShipments([shipment(), shipment({ destinationId: JEBEL_ALI })])
    expect(clusters).toHaveLength(0)
  })

  /**
   * A branch is a legal entity and a consolidation belongs to one.
   *
   * A coordinator holding roles in Kuwait and Dubai sees both branches' loose
   * shipments; grouping across them would propose a master that cannot be
   * created, and there is nothing on the suggestion to hint at why.
   */
  it('does not group two branches, even on the same lane and week', () => {
    const clusters = clusterShipments([shipment(), shipment({ branchId: DUBAI })])
    expect(clusters).toHaveLength(0)
  })

  it('carries the branch onto the cluster', () => {
    const clusters = clusterShipments([shipment(), shipment()])
    expect(clusters[0]?.branchId).toBe(KUWAIT)
  })

  it('does not group across modes', () => {
    const clusters = clusterShipments([shipment(), shipment({ mode: 'air' })])
    expect(clusters).toHaveLength(0)
  })

  /**
   * A shipment with no lane is left out rather than grouped as "unknown".
   *
   * Null origins are usually an enquiry-born job nobody has finished, and a
   * cluster whose only shared property is incompleteness is noise.
   */
  it('leaves a shipment with no lane out entirely', () => {
    const clusters = clusterShipments([
      shipment({ originId: null }),
      shipment({ destinationId: null }),
      shipment(),
    ])
    expect(clusters).toHaveLength(0)
  })

  it('splits a lane into separate sailings when the gap is too wide', () => {
    const clusters = clusterShipments([
      shipment({ readyOn: new Date('2026-09-01T00:00:00Z') }),
      shipment({ readyOn: new Date('2026-09-02T00:00:00Z') }),
      shipment({ readyOn: new Date('2026-10-01T00:00:00Z') }),
      shipment({ readyOn: new Date('2026-10-03T00:00:00Z') }),
    ])

    expect(clusters).toHaveLength(2)
    expect(clusters.every((c) => c.shipments.length === 2)).toBe(true)
  })

  /**
   * A run of closely-spaced dates stays one window even when the ends are far
   * apart. The split is on the *gap* to the next shipment, not on a fixed
   * calendar week, because fixed weeks separate a Sunday from the Monday after
   * it for no reason a coordinator would recognise.
   */
  it('keeps a chain of near-daily shipments together', () => {
    const clusters = clusterShipments(
      [0, 3, 6, 9, 12].map((day) =>
        shipment({ readyOn: new Date(Date.UTC(2026, 8, 1 + day)) }),
      ),
    )

    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.shipments).toHaveLength(5)
  })

  /** Undated bookings are real candidates, but cannot anchor a window. */
  it('puts undated shipments in a window of their own', () => {
    const clusters = clusterShipments([
      shipment({ readyOn: new Date('2026-09-01T00:00:00Z') }),
      shipment({ readyOn: new Date('2026-09-02T00:00:00Z') }),
      shipment({ readyOn: null }),
      shipment({ readyOn: null }),
    ])

    expect(clusters).toHaveLength(2)
    expect(clusters.some((c) => c.earliest === null)).toBe(true)
  })

  it('ignores a lone shipment — one is not a consolidation', () => {
    expect(clusterShipments([shipment()])).toHaveLength(0)
  })

  /**
   * Ordered by freight, not by count.
   *
   * Six two-cubic-metre shipments are a busy afternoon; two of twenty-eight
   * are the container. This screen answers "what to do first".
   */
  it('puts the most freight first', () => {
    const clusters = clusterShipments([
      shipment({ originId: JEBEL_ALI, originName: 'Jebel Ali', volumeCbm: 2 }),
      shipment({ originId: JEBEL_ALI, originName: 'Jebel Ali', volumeCbm: 2 }),
      shipment({ volumeCbm: 20 }),
      shipment({ volumeCbm: 20 }),
    ])

    expect(clusters[0]?.totalCbm).toBe(40)
    expect(clusters[1]?.totalCbm).toBe(4)
  })

  /** The same shipments in any order give the same answer — a suggestion that
      moves between two loads of a screen is one nobody trusts twice. */
  it('is deterministic whatever order the rows arrive in', () => {
    const rows = [
      shipment({ readyOn: new Date('2026-09-01T00:00:00Z') }),
      shipment({ readyOn: new Date('2026-09-04T00:00:00Z') }),
      shipment({ readyOn: new Date('2026-09-06T00:00:00Z') }),
    ]

    const forwards = clusterShipments(rows)
    const backwards = clusterShipments([...rows].reverse())

    expect(backwards.map((c) => c.key)).toEqual(forwards.map((c) => c.key))
    expect(backwards[0]?.shipments.map((s) => s.jobId)).toEqual(
      forwards[0]?.shipments.map((s) => s.jobId),
    )
  })

  it('treats a missing figure as nothing rather than refusing the cluster', () => {
    const clusters = clusterShipments([
      shipment({ volumeCbm: 10, grossWeightKg: null, pieces: null }),
      shipment({ volumeCbm: null, grossWeightKg: 500, pieces: 3 }),
    ])

    expect(clusters[0]?.totalCbm).toBe(10)
    expect(clusters[0]?.totalKg).toBe(500)
    expect(clusters[0]?.totalPieces).toBe(3)
  })
})

describe('which container would take it', () => {
  it('picks the smallest that holds the lot, because the cheaper box is the saving', () => {
    expect(fitFor(24, 6000)?.code).toBe('20GP')
    expect(fitFor(40, 9000)?.code).toBe('40GP')
  })

  it('reports nothing where the cargo exceeds every container', () => {
    expect(fitFor(120, 5000)).toBeNull()
  })

  /**
   * Weight binds before volume on anything dense, and saying so is the point.
   *
   * Three pallets of tiles fill a 20' by payload at a third of its cubic
   * capacity, and a suggestion that ignored that would put a coordinator in
   * front of a road limit.
   */
  it('names weight as the limit on dense cargo', () => {
    const fit = fitFor(10, 27_000)
    expect(fit?.code).toBe('20GP')
    expect(fit?.limitedBy).toBe('weight')
  })

  it('names volume as the limit on light cargo', () => {
    const fit = fitFor(27, 2_000)
    expect(fit?.limitedBy).toBe('volume')
  })

  it('refuses a 20 foot container for cargo over its payload', () => {
    // Under the volume ceiling, far over the weight one.
    expect(fitFor(20, 29_000)?.code).not.toBe('20GP')
  })

  /** The capacities are usable volume, not internal — cartons are not liquid. */
  it('quotes usable volume, well under the internal measurement', () => {
    const hc = CONTAINER_CAPACITIES.find((c) => c.code === '40HC')
    expect(hc?.usableCbm).toBeLessThan(76)
  })

  it('attaches the fit to the cluster', () => {
    const clusters = clusterShipments([
      shipment({ volumeCbm: 12, grossWeightKg: 3000 }),
      shipment({ volumeCbm: 12, grossWeightKg: 3000 }),
    ])

    expect(clusters[0]?.fit?.code).toBe('20GP')
    expect(clusters[0]?.fit?.volumePercent).toBeGreaterThan(80)
  })
})
