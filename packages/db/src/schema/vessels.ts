/**
 * Vessel positions from AIS — the latest fix per vessel, written by the service.
 *
 * One row per MMSI, updated in place. The alternative, a row per report, grows
 * by thousands a day for data nobody reads once a voyage ends, and in a
 * product where nothing is deleted it could never be trimmed. So the row holds
 * the latest fix, and `track` holds a short history capped by
 * `appendTrackPoint` in core: bounded by construction, with nothing ever
 * deleted because no point was ever a row.
 *
 * ## Why this is a system table
 *
 * `systemTable` opts out of the audit trigger, and only of that. Row-level
 * security is still enabled, forced and given a policy in the migration, so
 * readers see a vessel exactly when they can see a job sailing on it.
 *
 * The audit trail is the wrong tool here for a concrete reason: this row is
 * rewritten every few minutes per vessel by the service, from a third party's
 * broadcast. Auditing it would put an `audit_log` row per AIS report, forever,
 * to record that a ship moved. The business fact, *which* vessel a job sails
 * on, is `jobs.vessel_mmsi` and `jobs.vessel_imo`, and that is audited with
 * the rest of the job.
 */

import { doublePrecision, index, integer, jsonb, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { pk, ref, timestamps, tsz } from './columns'
import { systemTable } from './table'
import { locations } from './reference'

export interface VesselTrackPointRow {
  readonly lat: number
  readonly lon: number
  readonly at: string
}

export const vesselPositions = systemTable(
  'AIS telemetry rewritten every few minutes by the service. RLS-scoped through jobs; ' +
    'the audited fact is jobs.vessel_mmsi, not each report.',
)(
  'vessel_positions',
  {
    id: pk(),
    /** The radio identity every AIS message is keyed on. */
    mmsi: text('mmsi').notNull(),
    /**
     * Identity as the ship itself broadcasts it, from `ShipStaticData`.
     *
     * Learned, never typed. A job names its vessel in `jobs`; these columns
     * are what lets a person check that the MMSI on a job is the ship they
     * meant, and what a suggestion is drawn from. A suggestion is never
     * applied without a person confirming it.
     */
    imo: text('imo'),
    name: text('name'),
    callSign: text('call_sign'),
    shipType: integer('ship_type'),
    staticAt: tsz('static_at'),

    /** Null until the first position arrives — static data can come first. */
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    speedKnots: doublePrecision('speed_knots'),
    courseDegrees: doublePrecision('course_degrees'),
    headingDegrees: doublePrecision('heading_degrees'),
    /** ITU-R M.1371 navigational status code; see `vesselNavStatusKey`. */
    navStatus: integer('nav_status'),
    /**
     * What the crew typed into the transponder. Free text, often a LOCODE,
     * sometimes `FOR ORDERS`, and never our estimate.
     */
    reportedDestination: text('reported_destination'),
    reportedEta: tsz('reported_eta'),
    /** When the vessel transmitted the fix, from the provider's metadata. */
    positionAt: tsz('position_at'),
    /** When this service received it. Staleness is measured from here. */
    receivedAt: tsz('received_at'),
    /**
     * The nearest port in `locations` at the time of the fix, if one was
     * close enough to say "near" honestly. Computed by the writer so readers
     * need no geometry.
     */
    nearLocationId: ref('near_location_id').references(() => locations.id),
    /** Which driver wrote the latest fix — `aisstream`, later a satellite feed. */
    source: text('source').notNull(),
    track: jsonb('track').$type<VesselTrackPointRow[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('vessel_positions_mmsi_idx').on(t.mmsi),
    index('vessel_positions_imo_idx').on(t.imo),
  ],
)
