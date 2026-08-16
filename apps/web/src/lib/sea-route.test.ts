/**
 * Sea routing.
 *
 * The assertions here are geographic rather than numeric: a route is correct
 * when it passes through the chokepoints a ship actually passes through, and
 * when it stays out of places a ship cannot go. Asserting on distances would
 * be asserting on the waypoint positions, which are approximate on purpose.
 *
 * The land checks use crude bounding boxes over places these lanes would
 * otherwise cut across — the Alps, the Sahara, the Tibetan plateau. They are
 * not a general "is this water" test and are not trying to be; they are
 * regression tests for the specific way the old bezier was wrong.
 */

import { describe, expect, it } from 'vitest'
import { distanceKm, greatCircle, laneGeometry, seaRoute, type LonLat } from './sea-route'

const ROTTERDAM: LonLat = [4.13, 51.95]
const HAMBURG: LonLat = [9.97, 53.55]
const SHUWAIKH: LonLat = [47.93, 29.35]
const JEBEL_ALI: LonLat = [55.03, 24.98]
const SHANGHAI: LonLat = [121.5, 31.2]
const NHAVA_SHEVA: LonLat = [72.95, 18.95]
const DUBAI_AIRPORT: LonLat = [55.36, 25.25]

/** True where the route passes within `km` of a point. */
function passesNear(route: readonly LonLat[], point: LonLat, km: number): boolean {
  return route.some((step) => distanceKm(step, point) <= km)
}

/** True where any coordinate falls inside `[west, south, east, north]`. */
function entersBox(
  route: readonly LonLat[],
  [west, south, east, north]: [number, number, number, number],
): boolean {
  return route.some(([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north)
}

const SUEZ: LonLat = [32.5, 30.2]
const GIBRALTAR: LonLat = [-5.6, 35.95]
const BAB_EL_MANDEB: LonLat = [43.4, 12.6]
const HORMUZ: LonLat = [56.4, 26.6]
const MALACCA: LonLat = [100.5, 3.0]

// Places a sea lane must never appear. Deliberately conservative boxes well
// inside each landmass, so a coastal waypoint does not trip them.
const ALPS: [number, number, number, number] = [7, 45.5, 13, 47.5]
const SAHARA: [number, number, number, number] = [0, 20, 25, 30]
const TIBET: [number, number, number, number] = [80, 30, 95, 38]
const CENTRAL_ASIA: [number, number, number, number] = [55, 38, 75, 48]
/** Inland Iraq and the Zagros — the Rotterdam–Dubai great circle flies over it. */
const MESOPOTAMIA: [number, number, number, number] = [40, 32, 50, 38]

describe('greatCircle', () => {
  it('starts and ends where it was asked to', () => {
    const line = greatCircle(ROTTERDAM, SHANGHAI)
    expect(line[0]![0]).toBeCloseTo(ROTTERDAM[0], 4)
    expect(line[0]![1]).toBeCloseTo(ROTTERDAM[1], 4)
    expect(line.at(-1)![0]).toBeCloseTo(SHANGHAI[0], 4)
    expect(line.at(-1)![1]).toBeCloseTo(SHANGHAI[1], 4)
  })

  it('bows north of the straight line between two northern points', () => {
    // The whole reason to interpolate on the sphere: the shortest path from
    // Rotterdam to Shanghai goes far north of the latitude either sits at.
    const line = greatCircle(ROTTERDAM, SHANGHAI)
    const highest = Math.max(...line.map(([, lat]) => lat))
    expect(highest).toBeGreaterThan(Math.max(ROTTERDAM[1], SHANGHAI[1]))
  })

  it('produces coordinates that are all finite and in range', () => {
    for (const pair of [
      [ROTTERDAM, SHANGHAI],
      [SHUWAIKH, NHAVA_SHEVA],
      [JEBEL_ALI, JEBEL_ALI],
    ] as const) {
      for (const [lon, lat] of greatCircle(pair[0], pair[1])) {
        expect(Number.isFinite(lon)).toBe(true)
        expect(Number.isFinite(lat)).toBe(true)
        expect(Math.abs(lat)).toBeLessThanOrEqual(90.001)
      }
    }
  })
})

describe('seaRoute', () => {
  it('takes Rotterdam to Shuwaikh through Gibraltar, Suez and Hormuz', () => {
    const route = seaRoute(ROTTERDAM, SHUWAIKH)

    expect(passesNear(route, GIBRALTAR, 200)).toBe(true)
    expect(passesNear(route, SUEZ, 200)).toBe(true)
    expect(passesNear(route, BAB_EL_MANDEB, 200)).toBe(true)
    expect(passesNear(route, HORMUZ, 200)).toBe(true)
  })

  it('keeps that route off the Alps and out of the Sahara', () => {
    const route = seaRoute(ROTTERDAM, SHUWAIKH)
    expect(entersBox(route, ALPS)).toBe(false)
    expect(entersBox(route, SAHARA)).toBe(false)
  })

  it('takes Shuwaikh to Shanghai through Malacca rather than over Tibet', () => {
    const route = seaRoute(SHUWAIKH, SHANGHAI)

    expect(passesNear(route, HORMUZ, 250)).toBe(true)
    expect(passesNear(route, MALACCA, 300)).toBe(true)
    expect(entersBox(route, TIBET)).toBe(false)
    expect(entersBox(route, CENTRAL_ASIA)).toBe(false)
  })

  it('leaves Hamburg through the North Sea, not around Denmark', () => {
    /*
      Hamburg's *nearest* waypoint is the Kattegat, on the far side of
      Jutland. Routing to the single nearest node would send every Hamburg
      lane north around Denmark; considering three candidates lets the search
      pick the North Sea instead.
    */
    const route = seaRoute(HAMBURG, ROTTERDAM)
    const highest = Math.max(...route.map(([, lat]) => lat))
    expect(highest).toBeLessThan(56)
  })

  it('does not detour out to Hormuz for two ports inside the Gulf', () => {
    const route = seaRoute(JEBEL_ALI, SHUWAIKH)
    const furthestEast = Math.max(...route.map(([lon]) => lon))
    expect(furthestEast).toBeLessThan(JEBEL_ALI[0] + 1)
  })

  it('starts and ends at the ports it was given', () => {
    const route = seaRoute(ROTTERDAM, SHANGHAI)
    expect(distanceKm(route[0]!, ROTTERDAM)).toBeLessThan(1)
    expect(distanceKm(route.at(-1)!, SHANGHAI)).toBeLessThan(1)
  })

  it('never jumps the antimeridian', () => {
    // Consecutive coordinates more than 180° apart render as a line straight
    // back across the world.
    const route = seaRoute(SHUWAIKH, SHANGHAI)
    for (let i = 1; i < route.length; i++) {
      expect(Math.abs(route[i]![0] - route[i - 1]![0])).toBeLessThan(180)
    }
  })
})

describe('laneGeometry', () => {
  it('routes sea freight and flies everything else', () => {
    const sea = laneGeometry(ROTTERDAM, SHUWAIKH, 'sea_fcl')
    const air = laneGeometry(ROTTERDAM, DUBAI_AIRPORT, 'air')

    // Sea goes the long way round Iberia and through the canal; air does not.
    expect(passesNear(sea, SUEZ, 200)).toBe(true)
    expect(passesNear(air, SUEZ, 200)).toBe(false)

    // An air lane is a great circle, so it is far shorter — and it crosses
    // land, which is correct rather than a defect.
    expect(air.length).toBeLessThan(sea.length)
    expect(entersBox(air, MESOPOTAMIA)).toBe(true)
  })

  it('treats LCL the same as FCL', () => {
    expect(laneGeometry(ROTTERDAM, SHUWAIKH, 'sea_lcl')).toEqual(
      laneGeometry(ROTTERDAM, SHUWAIKH, 'sea_fcl'),
    )
  })
})
