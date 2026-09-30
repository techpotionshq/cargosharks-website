/**
 * The time-zone picker's labels — F64.
 *
 * The city in each label comes from the catalogue, keyed off the zone id. The
 * key is derived rather than listed, so the risk is a zone added to
 * `TIME_ZONES` with no entry: the picker would fall back to the English city on
 * an Arabic screen without anything failing. This is what fails instead.
 */

import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import ar from '../../messages/ar.json'
import { TIME_ZONES, describeTimeZone, timeZoneKey } from './time'

describe('the time-zone picker', () => {
  it.each(TIME_ZONES)('names %s in both languages', (zone) => {
    const key = timeZoneKey(zone) as keyof typeof en.timeZones
    expect(en.timeZones[key]).toBeTruthy()
    expect(ar.timeZones[key]).toBeTruthy()
  })

  it('derives the key from the city, words joined', () => {
    expect(timeZoneKey('Asia/Hong_Kong')).toBe('hongKong')
    expect(timeZoneKey('America/New_York')).toBe('newYork')
    expect(timeZoneKey('UTC')).toBe('utc')
  })

  it('puts the catalogue city before the offset', () => {
    expect(describeTimeZone('Asia/Kuwait', 'ar', ar.timeZones.kuwait)).toMatch(/^الكويت \(.+\)$/)
  })

  it('falls back to the zone id for a zone the menu does not list', () => {
    expect(describeTimeZone('America/Argentina/Buenos_Aires', 'en')).toMatch(/^Buenos Aires /)
  })
})
