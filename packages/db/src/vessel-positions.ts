/**
 * Vessel positions — the queries both sides share.
 *
 * The service writes through `recordVesselReports` under the system actor; the
 * web app reads through `vesselForJob` and `livePositionsForBoard` under the
 * person's own actor, and `vessel_positions_read` in the migration decides
 * which rows that person sees: exactly the vessels on jobs they can see.
 *
 * Everything here takes a `Tx`, so there is no un-actored path to this table,
 * the same as every other.
 */

import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  aisCoordinatesValid,
  appendTrackPoint,
  nearestPlace,
  normaliseImo,
  normaliseMmsi,
} from '@qabandi/core'
import type { Tx } from './actor'
import { jobs } from './schema/jobs'
import { locations } from './schema/reference'
import { vesselPositions, type VesselTrackPointRow } from './schema/vessels'

/**
 * The job statuses whose vessel is worth listening for.
 *
 * Booked and in transit are the voyage. `on_hold` is a job paused for a
 * reason that is not the ship's, and the ship is still sailing. Once a job has
 * arrived the vessel's onward voyage is somebody else's cargo.
 */
export const VESSEL_TRACKED_STATUSES = ['booked', 'in_transit', 'on_hold'] as const

/**
 * The MMSIs to subscribe to: every vessel on an open sea job, deduplicated.
 *
 * Read by the service under the system actor. Sorted, so two reads of the same
 * set compare equal and the subscription is only rebuilt when it changes.
 */
export async function openSeaVesselMmsis(tx: Tx): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ mmsi: jobs.vesselMmsi })
    .from(jobs)
    .where(
      and(
        isNotNull(jobs.vesselMmsi),
        inArray(jobs.mode, ['sea_fcl', 'sea_lcl']),
        inArray(jobs.status, [...VESSEL_TRACKED_STATUSES]),
        isNull(jobs.closedAt),
        isNull(jobs.cancelledAt),
      ),
    )
  return rows
    .map((row) => normaliseMmsi(row.mmsi))
    .filter((mmsi): mmsi is string => mmsi !== null)
    .sort()
}

/**
 * One report from any provider, already parsed into our terms.
 *
 * This is the seam a second driver plugs into: a websocket, a REST poll or a
 * webhook all produce these, and nothing downstream knows which. Numbers are
 * already cleaned of AIS sentinels by the driver.
 */
export type VesselReport =
  | {
      readonly kind: 'position'
      readonly mmsi: string
      readonly source: string
      readonly latitude: number
      readonly longitude: number
      readonly speedKnots: number | null
      readonly courseDegrees: number | null
      readonly headingDegrees: number | null
      readonly navStatus: number | null
      /** When the vessel sent it. */
      readonly positionAt: Date
      /** When we received it. */
      readonly receivedAt: Date
      /** Some providers carry the name on every message; it is a hint only. */
      readonly name?: string | null
    }
  | {
      readonly kind: 'static'
      readonly mmsi: string
      readonly source: string
      readonly imo: string | null
      readonly name: string | null
      readonly callSign: string | null
      readonly shipType: number | null
      readonly reportedDestination: string | null
      readonly reportedEta: Date | null
      readonly receivedAt: Date
    }

export interface NamedPlace {
  readonly id: string
  readonly latitude: number
  readonly longitude: number
}

/** Ports with coordinates, for "last seen near …". Read once and cached by the writer. */
export async function placesWithCoordinates(tx: Tx): Promise<NamedPlace[]> {
  const rows = await tx
    .select({ id: locations.id, latitude: locations.latitude, longitude: locations.longitude })
    .from(locations)
    .where(
      and(
        eq(locations.isActive, true),
        isNotNull(locations.latitude),
        isNotNull(locations.longitude),
      ),
    )
  return rows
    .map((row) => ({
      id: row.id,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    }))
    .filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude))
}

/**
 * Write a batch of reports: one upsert per vessel, latest fix wins.
 *
 * The writer buffers and calls this every few seconds rather than per message,
 * so a burst from a busy receiver is one statement per vessel and not one per
 * report. Within a batch only the newest position per vessel is kept, and a
 * position older than the one already stored is ignored — providers redeliver
 * and receivers relay late, and a late fix must not move the ship backwards.
 *
 * Returns how many vessels were written, for the log line.
 */
export async function recordVesselReports(
  tx: Tx,
  reports: readonly VesselReport[],
  places: readonly NamedPlace[] = [],
): Promise<number> {
  type Merged = {
    position?: Extract<VesselReport, { kind: 'position' }>
    static?: Extract<VesselReport, { kind: 'static' }>
  }
  const byMmsi = new Map<string, Merged>()

  for (const report of reports) {
    const mmsi = normaliseMmsi(report.mmsi)
    if (!mmsi) continue
    const merged = byMmsi.get(mmsi) ?? {}
    if (report.kind === 'position') {
      if (!aisCoordinatesValid(report.latitude, report.longitude)) continue
      if (!merged.position || report.positionAt > merged.position.positionAt) {
        merged.position = report
      }
    } else if (!merged.static || report.receivedAt > merged.static.receivedAt) {
      merged.static = report
    }
    byMmsi.set(mmsi, merged)
  }
  if (byMmsi.size === 0) return 0

  const existing = await tx
    .select({
      mmsi: vesselPositions.mmsi,
      positionAt: vesselPositions.positionAt,
      track: vesselPositions.track,
    })
    .from(vesselPositions)
    .where(inArray(vesselPositions.mmsi, [...byMmsi.keys()]))
  const current = new Map(existing.map((row) => [row.mmsi, row]))

  let written = 0
  for (const [mmsi, merged] of byMmsi) {
    const before = current.get(mmsi)
    const now = new Date()
    const values: Partial<typeof vesselPositions.$inferInsert> = {}
    let source: string | undefined

    const position =
      merged.position && (!before?.positionAt || merged.position.positionAt > before.positionAt)
        ? merged.position
        : undefined

    if (position) {
      const near = nearestPlace(position.latitude, position.longitude, places)
      Object.assign(values, {
        latitude: position.latitude,
        longitude: position.longitude,
        speedKnots: position.speedKnots,
        courseDegrees: position.courseDegrees,
        headingDegrees: position.headingDegrees,
        navStatus: position.navStatus,
        positionAt: position.positionAt,
        receivedAt: position.receivedAt,
        nearLocationId: near?.id ?? null,
        track: appendTrackPoint(before?.track as VesselTrackPointRow[] | undefined, {
          lat: position.latitude,
          lon: position.longitude,
          at: position.positionAt.toISOString(),
        }),
      })
      source = position.source
    }

    if (merged.static) {
      const s = merged.static
      Object.assign(values, {
        // A static message with an unreadable IMO keeps the one already learned.
        ...(normaliseImo(s.imo) ? { imo: normaliseImo(s.imo) } : {}),
        ...(s.name ? { name: s.name } : {}),
        ...(s.callSign ? { callSign: s.callSign } : {}),
        ...(s.shipType !== null ? { shipType: s.shipType } : {}),
        reportedDestination: s.reportedDestination,
        reportedEta: s.reportedEta,
        staticAt: s.receivedAt,
      })
      source ??= s.source
    } else if (position?.name && !before) {
      // Only on first sight: the name on a position message is the provider's
      // cache, and `ShipStaticData` is the authority once it has arrived.
      values.name = position.name
    }

    if (!source) continue

    await tx
      .insert(vesselPositions)
      .values({ mmsi, source, ...values })
      .onConflictDoUpdate({
        target: vesselPositions.mmsi,
        set: { ...values, source, updatedAt: now },
      })
    written++
  }
  return written
}

export interface JobVessel {
  readonly jobId: string
  readonly mode: string
  readonly vesselName: string | null
  readonly voyageNumber: string | null
  readonly imo: string | null
  readonly mmsi: string | null
  readonly position: VesselPositionView | null
  /** A vessel the person may confirm. Never applied without them. */
  readonly suggestion: VesselSuggestion | null
}

export interface VesselPositionView {
  readonly mmsi: string
  readonly imo: string | null
  readonly name: string | null
  readonly latitude: number | null
  readonly longitude: number | null
  readonly speedKnots: number | null
  readonly courseDegrees: number | null
  readonly navStatus: number | null
  readonly reportedDestination: string | null
  readonly reportedEta: Date | null
  readonly positionAt: Date | null
  readonly receivedAt: Date | null
  readonly nearNameEn: string | null
  readonly nearNameAr: string | null
  readonly source: string
  readonly track: readonly VesselTrackPointRow[]
}

export interface VesselSuggestion {
  readonly mmsi: string
  readonly imo: string | null
  readonly name: string | null
  /** `imo` is strong evidence; `name` alone is weak and the screen says so. */
  readonly basis: 'imo' | 'name'
}

const positionColumns = {
  mmsi: vesselPositions.mmsi,
  imo: vesselPositions.imo,
  name: vesselPositions.name,
  latitude: vesselPositions.latitude,
  longitude: vesselPositions.longitude,
  speedKnots: vesselPositions.speedKnots,
  courseDegrees: vesselPositions.courseDegrees,
  navStatus: vesselPositions.navStatus,
  reportedDestination: vesselPositions.reportedDestination,
  reportedEta: vesselPositions.reportedEta,
  positionAt: vesselPositions.positionAt,
  receivedAt: vesselPositions.receivedAt,
  nearNameEn: locations.nameEn,
  nearNameAr: locations.nameAr,
  source: vesselPositions.source,
  track: vesselPositions.track,
}

/** Collapse whitespace and case so `MSC  Aurora` and `msc aurora` compare equal. */
function vesselNameKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/^M\/?V\.?\s+/, '')
    .replace(/\s+/g, ' ')
}

/**
 * One job's vessel: what the job says, the latest fix, and a suggestion.
 *
 * Undefined when the job is not visible to the actor. The position row is
 * subject to `vessel_positions_read`, so a contact who can see the job sees
 * its vessel and nobody else's.
 *
 * The suggestion is offered only when the job has no MMSI. A matching IMO is
 * strong evidence, since it stays with the hull; a matching name alone is
 * weak, because names repeat and are re-used after a sale. Either way it is a
 * suggestion a person confirms, and this function writes nothing.
 */
export async function vesselForJob(tx: Tx, jobId: string): Promise<JobVessel | undefined> {
  const [job] = await tx
    .select({
      id: jobs.id,
      mode: jobs.mode,
      vesselName: jobs.vesselName,
      voyageNumber: jobs.voyageNumber,
      imo: jobs.vesselImo,
      mmsi: jobs.vesselMmsi,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)
  if (!job) return undefined

  let position: VesselPositionView | null = null
  if (job.mmsi) {
    const [row] = await tx
      .select(positionColumns)
      .from(vesselPositions)
      .leftJoin(locations, eq(locations.id, vesselPositions.nearLocationId))
      .where(eq(vesselPositions.mmsi, job.mmsi))
      .limit(1)
    position = row ?? null
  }

  let suggestion: VesselSuggestion | null = null
  if (!job.mmsi && (job.imo || job.vesselName)) {
    const candidates = await tx
      .select({ mmsi: vesselPositions.mmsi, imo: vesselPositions.imo, name: vesselPositions.name })
      .from(vesselPositions)
      .where(
        job.imo
          ? eq(vesselPositions.imo, job.imo)
          : // The same normalisation as `vesselNameKey`, applied to the stored name.
            sql`regexp_replace(regexp_replace(upper(trim(${vesselPositions.name})), '^M/?V\\.?\\s+', ''), '\\s+', ' ', 'g') = ${vesselNameKey(job.vesselName ?? '')}`,
      )
      .limit(2)
    // Two ships answering to one name is exactly when a guess goes wrong.
    if (candidates.length === 1 && candidates[0]) {
      suggestion = { ...candidates[0], basis: job.imo ? 'imo' : 'name' }
    }
  }

  return {
    jobId: job.id,
    mode: job.mode,
    vesselName: job.vesselName,
    voyageNumber: job.voyageNumber,
    imo: job.imo,
    mmsi: job.mmsi,
    position,
    suggestion,
  }
}

export interface BoardVesselPosition {
  readonly jobId: string
  readonly reference: string
  readonly vesselName: string | null
  readonly latitude: number
  readonly longitude: number
  readonly receivedAt: Date
}

/**
 * The last known fix of every live sea job's vessel, for the dashboard map.
 *
 * Under the person's actor, so the board shows only their branches' jobs. The
 * caller decides what counts as current; this returns the fix and its age.
 */
export async function livePositionsForBoard(tx: Tx, limit = 100): Promise<BoardVesselPosition[]> {
  const rows = await tx
    .select({
      jobId: jobs.id,
      reference: jobs.reference,
      vesselName: sql<string | null>`coalesce(${jobs.vesselName}, ${vesselPositions.name})`,
      latitude: vesselPositions.latitude,
      longitude: vesselPositions.longitude,
      receivedAt: vesselPositions.receivedAt,
    })
    .from(jobs)
    .innerJoin(vesselPositions, eq(vesselPositions.mmsi, jobs.vesselMmsi))
    .where(
      and(
        inArray(jobs.status, [...VESSEL_TRACKED_STATUSES]),
        isNull(jobs.closedAt),
        isNull(jobs.cancelledAt),
        isNotNull(vesselPositions.latitude),
        isNotNull(vesselPositions.receivedAt),
      ),
    )
    .limit(limit)
  return rows.flatMap((row) =>
    row.latitude !== null && row.longitude !== null && row.receivedAt !== null
      ? [{ ...row, latitude: row.latitude, longitude: row.longitude, receivedAt: row.receivedAt }]
      : [],
  )
}

/**
 * Set a job's vessel identity — typed, or a suggestion confirmed.
 *
 * Values are normalised here as well as in the form, so a malformed MMSI can
 * never reach the subscription. Returns false when the job is not visible.
 */
export async function setJobVesselIdentity(
  tx: Tx,
  jobId: string,
  identity: { readonly imo: string | null; readonly mmsi: string | null },
): Promise<boolean> {
  const updated = await tx
    .update(jobs)
    .set({
      vesselImo: normaliseImo(identity.imo),
      vesselMmsi: normaliseMmsi(identity.mmsi),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId))
    .returning({ id: jobs.id })
  return updated.length > 0
}
