import { describe, expect, it } from 'vitest'
import {
  aisCoordinatesValid,
  aisCourse,
  aisSpeed,
  aisText,
  appendTrackPoint,
  integrationSpec,
  isLiveDriver,
  nearestPlace,
  normaliseImo,
  normaliseMmsi,
  vesselNavStatusKey,
  vesselPositionAgeMinutes,
  vesselPositionFreshness,
  VESSEL_TRACK_MAX_POINTS,
  type VesselTrackPoint,
} from '../src/index'

const now = new Date('2026-10-05T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)

describe('vesselPositionFreshness', () => {
  it('calls a fix current up to six hours, and stale after', () => {
    expect(vesselPositionFreshness(hoursAgo(0.1), now)).toBe('current')
    expect(vesselPositionFreshness(hoursAgo(6), now)).toBe('current')
    expect(vesselPositionFreshness(hoursAgo(6.01), now)).toBe('stale')
    expect(vesselPositionFreshness(hoursAgo(72), now)).toBe('stale')
  })

  it('says none when there is no fix, rather than inventing one', () => {
    expect(vesselPositionFreshness(null, now)).toBe('none')
    expect(vesselPositionFreshness(undefined, now)).toBe('none')
  })

  it('treats a clock slightly ahead of ours as current, and never a negative age', () => {
    const ahead = new Date(now.getTime() + 30_000)
    expect(vesselPositionFreshness(ahead, now)).toBe('current')
    expect(vesselPositionAgeMinutes(ahead, now)).toBe(0)
    expect(vesselPositionAgeMinutes(hoursAgo(2.25), now)).toBe(135)
  })
})

describe('vessel identifiers', () => {
  it('accepts an IMO number only with a correct check digit', () => {
    // 9074729: 9*7+0*6+7*5+4*4+7*3+2*2 = 139, check digit 9.
    expect(normaliseImo('9074729')).toBe('9074729')
    expect(normaliseImo('IMO 9074729')).toBe('9074729')
    expect(normaliseImo('imo9074729')).toBe('9074729')
    // One transposed pair — the copying error the check exists for.
    expect(normaliseImo('9047729')).toBeNull()
    expect(normaliseImo('907472')).toBeNull()
    expect(normaliseImo('')).toBeNull()
    expect(normaliseImo(null)).toBeNull()
  })

  it('accepts a ship-station MMSI and refuses coast stations and short numbers', () => {
    expect(normaliseMmsi('477123400')).toBe('477123400')
    expect(normaliseMmsi(244650000)).toBe('244650000')
    expect(normaliseMmsi(' 477 123 400 ')).toBe('477123400')
    // 00MID… is a coast station, 111… a SAR aircraft, 99… an aid to navigation.
    expect(normaliseMmsi('002442000')).toBeNull()
    expect(normaliseMmsi('111244000')).toBeNull()
    expect(normaliseMmsi('992441234')).toBeNull()
    expect(normaliseMmsi('47712340')).toBeNull()
  })
})

describe('AIS field hygiene', () => {
  it('reads the protocol sentinels as absent, not as values', () => {
    expect(aisSpeed(102.3)).toBeNull()
    expect(aisSpeed(14.2)).toBe(14.2)
    expect(aisCourse(360)).toBeNull()
    expect(aisCourse(359.9)).toBe(359.9)
    expect(aisCoordinatesValid(91, 0)).toBe(false)
    expect(aisCoordinatesValid(0, 0)).toBe(false)
    expect(aisCoordinatesValid(51.9, 4.1)).toBe(true)
  })

  it('maps defined navigational statuses and drops the undefined ones', () => {
    expect(vesselNavStatusKey(0)).toBe('underWayEngine')
    expect(vesselNavStatusKey(5)).toBe('moored')
    expect(vesselNavStatusKey(15)).toBeNull()
    expect(vesselNavStatusKey(null)).toBeNull()
  })

  it('strips the six-bit padding from what the crew typed', () => {
    expect(aisText('KWSWK@@@@@@@')).toBe('KWSWK')
    expect(aisText('  FOR   ORDERS ')).toBe('FOR ORDERS')
    expect(aisText('@@@@')).toBeNull()
  })

  it('names the nearest place only within the radius', () => {
    const places = [
      { name: 'Rotterdam', latitude: 51.95, longitude: 4.14 },
      { name: 'Shanghai', latitude: 31.23, longitude: 121.47 },
    ]
    expect(nearestPlace(51.98, 3.9, places)?.name).toBe('Rotterdam')
    // Mid-Indian Ocean: nothing is honestly "near".
    expect(nearestPlace(5, 75, places)).toBeNull()
  })
})

describe('appendTrackPoint', () => {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString()

  it('adds a point only once the spacing has passed', () => {
    let track: VesselTrackPoint[] = appendTrackPoint([], { lat: 1, lon: 1, at: at(0) })
    track = appendTrackPoint(track, { lat: 1.1, lon: 1, at: at(10) })
    expect(track).toHaveLength(1)
    track = appendTrackPoint(track, { lat: 1.2, lon: 1, at: at(31) })
    expect(track).toHaveLength(2)
  })

  it('ignores a late message older than the last point', () => {
    const track = appendTrackPoint([{ lat: 1, lon: 1, at: at(60) }], { lat: 0, lon: 0, at: at(0) })
    expect(track).toEqual([{ lat: 1, lon: 1, at: at(60) }])
  })

  it('keeps only the newest points, so the row stays bounded', () => {
    let track: VesselTrackPoint[] = []
    for (let i = 0; i < VESSEL_TRACK_MAX_POINTS + 10; i++) {
      track = appendTrackPoint(track, { lat: i, lon: 0, at: at(i * 30) })
    }
    expect(track).toHaveLength(VESSEL_TRACK_MAX_POINTS)
    expect(track[0]?.lat).toBe(10)
    expect(track.at(-1)?.lat).toBe(VESSEL_TRACK_MAX_POINTS + 9)
  })
})

describe('the vesselPositions integration', () => {
  it('ships off, and only aisstream is a live driver', () => {
    const spec = integrationSpec('vesselPositions')
    expect(spec?.defaultDriver).toBe('off')
    expect(isLiveDriver(spec!, undefined)).toBe(false)
    expect(isLiveDriver(spec!, 'off')).toBe(false)
    expect(isLiveDriver(spec!, 'aisstream')).toBe(true)
    expect(spec?.secrets.map((s) => s.env)).toEqual(['AISSTREAM_API_KEY'])
  })
})
