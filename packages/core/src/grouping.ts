/**
 * Which loose shipments should have been one container — the groupage question
 * asked *before* the consolidation exists.
 *
 * `allocation.ts` is the other half and it is already written: it splits one
 * master cost across twenty houses, exactly, reproducibly, explainably. That
 * engine answers "what does house eleven owe of the ocean freight". It cannot
 * answer the question that comes first, which is the one the margin actually
 * lives in: *should houses one through eleven have been on the same box at
 * all?*
 *
 * Today that decision is a coordinator remembering that two other customers
 * also ship Shanghai to Shuwaikh, and it is made — or missed — one booking at
 * a time. Missing it is not a visible error. Three LCL bookings each bought at
 * an LCL rate simply cost what they cost, and the FCL that would have carried
 * all three for less was never priced. Nothing in the ledger records the
 * consolidation that did not happen.
 *
 * ## Grouping is arithmetic, and stays arithmetic
 *
 * There is no model anywhere in this file, and there should not be. A cluster
 * is shipments that share a lane, a mode and a sailing window; whether they
 * fit is volume and weight against a steel box. Both are computable, both are
 * defensible to a customer asking why their cargo moved with somebody else's,
 * and neither becomes more correct for being guessed at. `docs/Qabandi_AI_
 * Surface.md` makes the same call about agent scoring: *measure the inputs, do
 * the arithmetic, generate the explanation.*
 *
 * ## It proposes a grouping; it never makes one
 *
 * Every cluster here is a suggestion a person acts on. Consolidating cargo
 * commits customers to a sailing and to each other's timing, and the reasons
 * not to are frequently invisible in this data — a customer who will not
 * co-load, a shipper whose "ready" date is optimistic, a commodity that cannot
 * travel with another. The screen shows what the figures say and a coordinator
 * decides, which is the same shape `extraction_proposals` takes for a
 * different kind of guess.
 */

/**
 * How much cargo actually fits, by container code, in cubic metres.
 *
 * Physical facts about steel boxes, so a constant rather than a settings row —
 * and the distinction from `charge_types` is real. A charge type is a business
 * rule an administrator changes without a release (FR-AD-03); the internal
 * volume of a 40' high cube is not something a deployment gets to have an
 * opinion about, and a column inviting one would eventually hold a wrong
 * number nobody could source.
 *
 * The figures are *usable* volume, not internal volume, and the difference is
 * the whole point. A 40HC measures about 76 m³ between its walls and takes
 * roughly 60 m³ of palletised freight, because cartons are not liquid: they
 * stack in whole units, leave voids at the top of the last tier, and cannot be
 * loaded to the door. Quoting the internal figure would produce a screen that
 * confidently proposes a container nothing will actually fit into.
 *
 * `maxKg` is the payload — what may be loaded, not what the box weighs — and
 * it binds long before volume on anything dense. Three pallets of tiles fill a
 * 20' by weight at a third of its cubic capacity, and a suggestion that
 * ignored that would put a coordinator in front of a road limit.
 */
export interface ContainerCapacity {
  readonly code: string
  readonly usableCbm: number
  readonly maxKg: number
}

export const CONTAINER_CAPACITIES: readonly ContainerCapacity[] = [
  { code: '20GP', usableCbm: 28, maxKg: 28_000 },
  { code: '40GP', usableCbm: 56, maxKg: 26_500 },
  { code: '40HC', usableCbm: 60, maxKg: 26_500 },
]

/** A shipment that could join a group. Figures as text, parsed by the caller. */
export interface GroupableShipment {
  readonly jobId: string
  readonly reference: string
  /**
   * The branch that owns the shipment.
   *
   * Part of the grouping key, not merely carried. A branch is a legal entity
   * (FR-ID-01) and a consolidation belongs to exactly one — so a cluster
   * spanning two would suggest a master that cannot be created, to a
   * coordinator who holds roles in both and would have no reason to doubt it.
   */
  readonly branchId: string
  readonly customerId: string | null
  readonly customerName: string | null
  readonly mode: string
  readonly originId: string | null
  readonly destinationId: string | null
  readonly originName: string | null
  readonly destinationName: string | null
  /** What the cargo is ready to move — `etd` where a job has one. */
  readonly readyOn: Date | null
  readonly volumeCbm: number | null
  readonly grossWeightKg: number | null
  readonly pieces: number | null
}

/** How well one container would be filled by a cluster's cargo. */
export interface ContainerFit {
  readonly code: string
  readonly volumePercent: number
  readonly weightPercent: number
  /**
   * Which of the two runs out first.
   *
   * Named rather than inferred from the percentages, because it is the
   * sentence a coordinator needs: *"this is heavy, not big"* changes which
   * container is booked and whether a fourth shipment can still join.
   */
  readonly limitedBy: 'volume' | 'weight'
}

export interface ShipmentCluster {
  /** Stable across runs: branch, mode, lane and window. A React key and a form value. */
  readonly key: string
  readonly branchId: string
  readonly mode: string
  readonly originId: string
  readonly destinationId: string
  readonly originName: string | null
  readonly destinationName: string | null
  readonly shipments: readonly GroupableShipment[]
  readonly totalCbm: number
  readonly totalKg: number
  readonly totalPieces: number
  /** The customers involved — a group of one customer's shipments is a different sell. */
  readonly customerCount: number
  readonly earliest: Date | null
  readonly latest: Date | null
  /** The smallest container that would hold it, or null where nothing would. */
  readonly fit: ContainerFit | null
}

export interface ClusterOptions {
  /**
   * How far apart two "ready" dates may be and still share a sailing.
   *
   * Seven by default, which is one weekly service. Shorter and a Monday and a
   * Friday booking on the same vessel look like different groups; much longer
   * and the screen proposes holding a customer's cargo for a fortnight to save
   * a co-load fee, which is a trade nobody asked for.
   */
  readonly windowDays?: number
  /** Clusters smaller than this are not worth a coordinator's attention. */
  readonly minimumShipments?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Loose shipments, grouped into the containers they could have shared.
 *
 * Pure, ordered and deterministic: the same shipments in any input order give
 * the same clusters in the same sequence. That matters for the same reason
 * `allocation.ts` says it does — a suggestion that changes between two loads
 * of the same screen is one nobody trusts twice.
 *
 * Grouping is per branch as well as per lane. A branch is a legal entity, a
 * consolidation belongs to one, and a cluster spanning two would propose a
 * master nobody can create.
 *
 * ## Why a lane is an exact pair and not a radius
 *
 * Two ports 40km apart are not one lane. Jebel Ali and Abu Dhabi are both "the
 * UAE" and a shipment routed through the wrong one arrives at a terminal the
 * consignee has no arrangement with. Grouping is therefore on the *same*
 * origin and destination rows, and a shipment with either missing is not
 * grouped at all — an unknown lane is not a lane in common, and pretending
 * otherwise is how somebody's cargo joins the wrong box.
 */
export function clusterShipments(
  shipments: readonly GroupableShipment[],
  options: ClusterOptions = {},
): ShipmentCluster[] {
  const windowDays = options.windowDays ?? 7
  const minimum = options.minimumShipments ?? 2

  const byLane = new Map<string, GroupableShipment[]>()

  for (const shipment of shipments) {
    /*
      A shipment with no lane is not grouped, rather than grouped as "unknown".

      An `originId` of null means nobody has said where this moves from — most
      often an enquiry-born job nobody has finished. Putting those together
      would produce a cluster whose only shared property is incompleteness.
    */
    if (!shipment.originId || !shipment.destinationId) continue

    const key = `${shipment.branchId}|${shipment.mode}|${shipment.originId}|${shipment.destinationId}`
    const existing = byLane.get(key)
    if (existing) existing.push(shipment)
    else byLane.set(key, [shipment])
  }

  const clusters: ShipmentCluster[] = []

  for (const [lane, lot] of byLane) {
    for (const window of splitByWindow(lot, windowDays)) {
      if (window.length < minimum) continue
      clusters.push(describe(lane, window))
    }
  }

  /*
    Biggest first, and by volume rather than by count.

    Six shipments of two cubic metres each are a busy afternoon; two of
    twenty-eight are the container. The question this list answers is what to
    do first, and the answer is the one with the most freight on it.
  */
  return clusters.sort(
    (a, b) => b.totalCbm - a.totalCbm || b.shipments.length - a.shipments.length || a.key.localeCompare(b.key),
  )
}

/**
 * One lane's shipments, cut into sailing windows.
 *
 * Sorted by date and split wherever the gap to the next shipment exceeds the
 * window — a greedy pass rather than fixed calendar weeks, deliberately. Fixed
 * weeks put a Sunday and the following Monday in different groups for no
 * reason a coordinator would recognise, which is the failure that makes a
 * suggestion screen look stupid the first time somebody checks it.
 *
 * Shipments with no date at all form their own window. They are groupable —
 * an undated booking on a known lane is a real candidate — but they cannot
 * anchor a window, because "no date" is compatible with every date and would
 * otherwise merge every window on the lane into one.
 */
function splitByWindow(lot: readonly GroupableShipment[], windowDays: number): GroupableShipment[][] {
  const dated = lot.filter((s) => s.readyOn !== null).sort((a, b) => a.readyOn!.getTime() - b.readyOn!.getTime())
  const undated = lot.filter((s) => s.readyOn === null)

  const windows: GroupableShipment[][] = []
  let current: GroupableShipment[] = []

  for (const shipment of dated) {
    if (current.length === 0) {
      current.push(shipment)
      continue
    }
    const previous = current[current.length - 1]!
    const gap = (shipment.readyOn!.getTime() - previous.readyOn!.getTime()) / DAY_MS
    if (gap <= windowDays) current.push(shipment)
    else {
      windows.push(current)
      current = [shipment]
    }
  }
  if (current.length > 0) windows.push(current)
  if (undated.length > 0) windows.push(undated)

  return windows
}

function describe(lane: string, shipments: readonly GroupableShipment[]): ShipmentCluster {
  const [branchId, mode, originId, destinationId] = lane.split('|') as [
    string,
    string,
    string,
    string,
  ]

  const totalCbm = round3(sumOf(shipments, (s) => s.volumeCbm))
  const totalKg = round3(sumOf(shipments, (s) => s.grossWeightKg))
  const totalPieces = Math.round(sumOf(shipments, (s) => s.pieces))

  const dates = shipments.map((s) => s.readyOn).filter((d): d is Date => d !== null)
  const first = shipments[0]!

  return {
    key: `${lane}|${dates.length > 0 ? isoDay(dates[0]!) : 'undated'}`,
    branchId,
    mode,
    originId,
    destinationId,
    originName: first.originName,
    destinationName: first.destinationName,
    shipments,
    totalCbm,
    totalKg,
    totalPieces,
    customerCount: new Set(shipments.map((s) => s.customerId).filter(Boolean)).size,
    earliest: dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
    latest: dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
    fit: fitFor(totalCbm, totalKg),
  }
}

/**
 * The smallest container that would take the lot.
 *
 * Smallest rather than best-filled, because the cheaper box is the saving. A
 * cluster that fills a 20' to 90% and a 40HC to 42% should read as a 20', and
 * a screen preferring the fuller-looking larger container would be selling the
 * wrong thing well.
 *
 * Returns null where nothing holds it, and that is a useful answer rather than
 * a failure: cargo exceeding a 40HC is either two containers or an FCL in its
 * own right, and both are decisions above this function's pay grade.
 */
export function fitFor(totalCbm: number, totalKg: number): ContainerFit | null {
  for (const capacity of CONTAINER_CAPACITIES) {
    if (totalCbm > capacity.usableCbm || totalKg > capacity.maxKg) continue

    const volumePercent = pct(totalCbm, capacity.usableCbm)
    const weightPercent = pct(totalKg, capacity.maxKg)

    return {
      code: capacity.code,
      volumePercent,
      weightPercent,
      limitedBy: weightPercent > volumePercent ? 'weight' : 'volume',
    }
  }
  return null
}

const sumOf = <T>(rows: readonly T[], pick: (row: T) => number | null): number =>
  rows.reduce((total, row) => total + (pick(row) ?? 0), 0)

const round3 = (value: number): number => Math.round(value * 1000) / 1000
const pct = (part: number, whole: number): number => Math.round((part / whole) * 1000) / 10
const isoDay = (date: Date): string => date.toISOString().slice(0, 10)
