/**
 * Vessel positions for the hosted demo — three ships, one of each state.
 *
 * Kept out of `fixtures.ts` because it is a separate feature with its own
 * small dataset, and anchored to the moment it is read like everything there:
 *
 *   job-1046  NORTHERN STAR, heard 25 minutes ago in the Strait of Malacca.
 *             The card draws a solid dot and calls it current.
 *   job-1044  MERIDIAN, last heard three days ago near Colombo. Stale: the
 *             card says when and where, and that the ship may be outside
 *             receiver coverage, which on the run into the Gulf it is.
 *   job-1045  The portal customer's export to Jeddah. MMSI known, nothing
 *             heard: the honest "no recent position" message.
 *   job-1048  Names MERIDIAN and has no MMSI, so the job card offers job-1044's
 *             ship as a name-only suggestion for a person to confirm.
 *
 * The MMSIs carry real flag prefixes (477 Hong Kong, 538 Marshall Islands,
 * 403 Saudi Arabia) and the IMO numbers pass the check digit, but no ship
 * here is a real ship: the same rule `fixtures.ts` applies to companies.
 */

import type { BoardVesselPosition, JobVessel, VesselPositionView } from '@qabandi/db'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

interface PilotVessel {
  readonly jobId: string
  readonly reference: string
  readonly vesselName: string
  readonly voyageNumber: string
  readonly mmsi: string | null
  readonly imo: string | null
  /** Hours ago the last fix arrived, or null for never. */
  readonly heardHoursAgo: number | null
  readonly latitude: number
  readonly longitude: number
  readonly speedKnots: number
  readonly courseDegrees: number
  readonly near: { readonly en: string; readonly ar: string } | null
  readonly reportedDestination: string
  readonly reportedEtaDays: number
  /** Degrees moved per half-hour step, for the short track behind the dot. */
  readonly step: readonly [number, number]
}

const VESSELS: readonly PilotVessel[] = [
  {
    jobId: 'job-1046',
    reference: 'KWI-1046',
    vesselName: 'NORTHERN STAR',
    voyageNumber: '006W',
    mmsi: '477318200',
    imo: '9321483',
    heardHoursAgo: 25 / 60,
    latitude: 3.21,
    longitude: 100.62,
    speedKnots: 15.2,
    courseDegrees: 302,
    near: { en: 'Port Klang', ar: 'ميناء كلانغ' },
    reportedDestination: 'KW SHUAIBA',
    reportedEtaDays: 9.2,
    step: [-0.06, 0.1],
  },
  {
    jobId: 'job-1044',
    reference: 'KWI-1044',
    vesselName: 'MERIDIAN',
    voyageNumber: '004W',
    mmsi: '538009413',
    imo: '9482110',
    heardHoursAgo: 71,
    latitude: 6.82,
    longitude: 79.61,
    speedKnots: 16.4,
    courseDegrees: 296,
    near: { en: 'Colombo', ar: 'كولومبو' },
    reportedDestination: 'KWSWK',
    reportedEtaDays: 5.1,
    step: [-0.05, 0.12],
  },
  {
    jobId: 'job-1045',
    reference: 'KWI-1045',
    vesselName: 'AL SALAM',
    voyageNumber: '005W',
    mmsi: '403512000',
    imo: '9786542',
    heardHoursAgo: null,
    latitude: 0,
    longitude: 0,
    speedKnots: 0,
    courseDegrees: 0,
    near: null,
    reportedDestination: '',
    reportedEtaDays: 0,
    step: [0, 0],
  },
]

function position(vessel: PilotVessel, now: number): VesselPositionView | null {
  if (!vessel.mmsi || vessel.heardHoursAgo === null) return null
  const receivedAt = new Date(now - vessel.heardHoursAgo * HOUR)
  // Ten half-hour points ending at the fix, walked back along the course.
  const track = Array.from({ length: 10 }, (_, i) => {
    const back = 9 - i
    return {
      lat: vessel.latitude - vessel.step[1] * back,
      lon: vessel.longitude - vessel.step[0] * back,
      at: new Date(receivedAt.getTime() - back * 30 * MINUTE).toISOString(),
    }
  })
  return {
    mmsi: vessel.mmsi,
    imo: vessel.imo,
    name: vessel.vesselName,
    latitude: vessel.latitude,
    longitude: vessel.longitude,
    speedKnots: vessel.speedKnots,
    courseDegrees: vessel.courseDegrees,
    navStatus: 0,
    reportedDestination: vessel.reportedDestination,
    reportedEta: new Date(now + vessel.reportedEtaDays * 24 * HOUR),
    positionAt: new Date(receivedAt.getTime() - 4_000),
    receivedAt,
    nearNameEn: vessel.near?.en ?? null,
    nearNameAr: vessel.near?.ar ?? null,
    source: 'aisstream',
    track,
  }
}

/** The vessel card's data for one demo job, as `vesselForJob` would return it. */
export function pilotJobVessel(jobId: string, now = Date.now()): JobVessel | undefined {
  const vessel = VESSELS.find((v) => v.jobId === jobId)
  if (vessel) {
    return {
      jobId,
      mode: 'sea_fcl',
      vesselName: vessel.vesselName,
      voyageNumber: vessel.voyageNumber,
      imo: vessel.imo,
      mmsi: vessel.mmsi,
      position: position(vessel, now),
      suggestion: null,
    }
  }
  if (jobId === 'job-1048') {
    const meridian = VESSELS[1]!
    return {
      jobId,
      mode: 'sea_fcl',
      vesselName: 'MERIDIAN',
      voyageNumber: '008E',
      imo: null,
      mmsi: null,
      position: null,
      suggestion: {
        mmsi: meridian.mmsi!,
        imo: meridian.imo,
        name: meridian.vesselName,
        basis: 'name',
      },
    }
  }
  return undefined
}

/** The board's dots: every demo vessel that has been heard at all. */
export function pilotBoardVessels(now = Date.now()): BoardVesselPosition[] {
  return VESSELS.flatMap((vessel) => {
    const fix = position(vessel, now)
    return fix?.receivedAt && fix.latitude !== null && fix.longitude !== null
      ? [
          {
            jobId: vessel.jobId,
            reference: vessel.reference,
            vesselName: vessel.vesselName,
            latitude: fix.latitude,
            longitude: fix.longitude,
            receivedAt: fix.receivedAt,
          },
        ]
      : []
  })
}
