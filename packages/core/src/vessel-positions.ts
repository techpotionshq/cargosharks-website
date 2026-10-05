/**
 * Vessel positions from AIS — the rules every reader and writer shares.
 *
 * AIS is the radio beacon every ocean-going ship carries. A position heard by
 * a receiver tells us where a vessel *was* at one instant, and nothing about
 * where it is now unless that instant was recent. The first provider
 * (aisstream.io) is terrestrial only: in a 120-second global sample on
 * 2026-10-05 it heard 10,790 positions and none at all in the Arabian Gulf,
 * the Gulf of Oman, the Red Sea or the Arabian Sea. So a vessel bound for
 * Shuwaikh or Jebel Ali goes quiet for days before it arrives, and the last
 * dot on the map is somewhere off Sri Lanka.
 *
 * The rule that follows is the one in this file the UI depends on: **a
 * position is shown as current only while it is fresh.** Past
 * `VESSEL_POSITION_STALE_HOURS` the screen says when and where the vessel was
 * last heard, and that it may be outside receiver coverage. It never moves the
 * dot forward by dead reckoning and never calls an old fix "live".
 *
 * Pure: no I/O, so the service, the web app and the tests all read the same
 * answer.
 */

/**
 * Past this age a position is "last seen", not "now".
 *
 * Six hours is long enough that a vessel crossing between two receivers on a
 * busy coast does not flicker to stale, and short enough that a ship that
 * left coverage this morning is not drawn as though it were still there.
 */
export const VESSEL_POSITION_STALE_HOURS = 6

export type VesselPositionFreshness = 'current' | 'stale' | 'none'

/** Whether a fix received at `receivedAt` may be shown as current at `now`. */
export function vesselPositionFreshness(
  receivedAt: Date | null | undefined,
  now: Date,
  staleHours = VESSEL_POSITION_STALE_HOURS,
): VesselPositionFreshness {
  if (!receivedAt) return 'none'
  const age = now.getTime() - receivedAt.getTime()
  // A clock a few seconds ahead of ours is still a current fix, not a future one.
  return age <= staleHours * 3_600_000 ? 'current' : 'stale'
}

/** Whole minutes since the fix, never negative — for "2 h 15 min ago". */
export function vesselPositionAgeMinutes(receivedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - receivedAt.getTime()) / 60_000))
}

/**
 * IMO ship identification number: seven digits, the last a check digit.
 *
 * The check is the weighted sum of the first six digits (weights 7 down to 2),
 * modulo 10. It catches the transposed digit a person makes copying a number
 * off a booking confirmation, which is the error that would otherwise point a
 * job at a different ship. Accepts an optional `IMO` prefix and spaces, as it
 * is printed on documents.
 */
export function normaliseImo(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.trim().toUpperCase().replace(/^IMO/, '').replace(/[\s-]/g, '')
  if (!/^\d{7}$/.test(digits)) return null
  let sum = 0
  for (let i = 0; i < 6; i++) sum += Number(digits[i]) * (7 - i)
  return sum % 10 === Number(digits[6]) ? digits : null
}

/**
 * MMSI — the nine-digit radio identity AIS keys every message on.
 *
 * A ship station's MMSI starts with its flag's three-digit MID, and every MID
 * is in 201–775, so the first digit is 2 to 7. Coast stations, aids to
 * navigation and SAR aircraft use other leading digits and are never the
 * vessel a cargo sails on.
 */
export function normaliseMmsi(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const digits = String(raw).trim().replace(/\s/g, '')
  return /^[2-7]\d{8}$/.test(digits) ? digits : null
}

/**
 * AIS navigational status (ITU-R M.1371, message types 1–3), by code.
 *
 * The keys are message keys in `vesselPosition.navStatus.*`. Codes 9–14 are
 * reserved or for special craft and 15 means "not defined", which is what most
 * transponders send when nobody set it; all of them read as `undefined`, and
 * the card shows nothing rather than a status nobody chose.
 */
const NAV_STATUS: Record<number, string> = {
  0: 'underWayEngine',
  1: 'atAnchor',
  2: 'notUnderCommand',
  3: 'restrictedManoeuvrability',
  4: 'constrainedByDraught',
  5: 'moored',
  6: 'aground',
  7: 'fishing',
  8: 'underWaySailing',
}

export const VESSEL_NAV_STATUS_KEYS: readonly string[] = Object.values(NAV_STATUS)

export function vesselNavStatusKey(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null
  return NAV_STATUS[code] ?? null
}

/**
 * AIS sentinel values mean "not available", not zero.
 *
 * Speed 102.3 knots, course 360, heading 511 and latitude 91 / longitude 181
 * are the protocol's way of saying a field is unset. Stored as they arrive
 * they would draw a ship at the North Pole doing a hundred knots.
 */
export function aisSpeed(knots: number | null | undefined): number | null {
  if (knots === null || knots === undefined || !Number.isFinite(knots)) return null
  return knots >= 102.3 || knots < 0 ? null : knots
}

export function aisCourse(degrees: number | null | undefined): number | null {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return null
  return degrees >= 360 || degrees < 0 ? null : degrees
}

export function aisHeading(degrees: number | null | undefined): number | null {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return null
  return degrees >= 360 || degrees < 0 ? null : degrees
}

export function aisCoordinatesValid(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    // 0,0 is "Null Island", the classic default of an unconfigured GPS.
    !(lat === 0 && lon === 0)
  )
}

/**
 * The destination a crew typed into the transponder, cleaned for display.
 *
 * Six-bit ASCII padded with `@`, free text, often a UN/LOCODE like `KWSWK` or
 * a phrase like `FOR ORDERS`. It is what the ship says, which is why every
 * screen labels it as reported by the vessel and never as our destination.
 */
export function aisText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/@+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned === '' ? null : cleaned
}

/** Great-circle distance in kilometres. Enough for "near which port". */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * The nearest named place to a fix, if one is within `withinKm`.
 *
 * "Last seen near Port Klang" is the sentence a customer understands; a pair
 * of coordinates is not. Beyond the radius there is no honest "near", and the
 * card says the vessel was at sea instead.
 */
export function nearestPlace<T extends { latitude: number; longitude: number }>(
  lat: number,
  lon: number,
  places: readonly T[],
  withinKm = 300,
): T | null {
  let best: T | null = null
  let bestKm = withinKm
  for (const place of places) {
    const km = distanceKm(lat, lon, place.latitude, place.longitude)
    if (km <= bestKm) {
      best = place
      bestKm = km
    }
  }
  return best
}

/**
 * A short track, kept on the latest-position row rather than in a table of
 * its own.
 *
 * Nothing is deleted in this product, and a table that appends a row per AIS
 * report grows by thousands a day for data nobody reads after the voyage. A
 * capped array on the one row per vessel is bounded by construction: the
 * newest point goes on, the oldest falls off, and nothing is deleted because
 * nothing was ever a row. A point is only added once `minSpacingMinutes` has
 * passed, so the cap covers hours rather than the last few minutes of
 * reports from a receiver that hears the ship every ten seconds.
 */
export interface VesselTrackPoint {
  readonly lat: number
  readonly lon: number
  /** ISO 8601. */
  readonly at: string
}

export const VESSEL_TRACK_MAX_POINTS = 48
export const VESSEL_TRACK_SPACING_MINUTES = 30

export function appendTrackPoint(
  track: readonly VesselTrackPoint[] | null | undefined,
  point: VesselTrackPoint,
  max = VESSEL_TRACK_MAX_POINTS,
  minSpacingMinutes = VESSEL_TRACK_SPACING_MINUTES,
): VesselTrackPoint[] {
  const current = [...(track ?? [])]
  const last = current.at(-1)
  if (last) {
    const gap = (Date.parse(point.at) - Date.parse(last.at)) / 60_000
    // Older than what we hold (a late or replayed message), or too soon.
    if (!(gap >= minSpacingMinutes)) return current
  }
  current.push(point)
  return current.length > max ? current.slice(current.length - max) : current
}
