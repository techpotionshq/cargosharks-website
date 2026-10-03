import { describe, expect, it } from 'vitest'
import { journey } from './journey'

const etd = new Date('2026-10-21T00:00:00Z')
const eta = new Date('2026-11-10T00:00:00Z')
const step = (code: string, actualAt: Date | null) => ({
  code,
  nameEn: code,
  nameAr: code,
  plannedAt: null,
  revisedAt: null,
  actualAt,
})

describe('departure and arrival on the shipment view (NEW-7)', () => {
  it('calls a planned ETD a plan while the departure milestone is open', () => {
    const { departure, arrival } = journey({
      etd,
      eta,
      atd: null,
      ata: null,
      milestones: [step('booking_confirmed', new Date()), step('vessel_departed', null)],
    })
    expect(departure).toEqual({ actual: false, at: etd })
    expect(arrival).toEqual({ actual: false, at: eta })
  })

  it('says departed, with the actual date, once the milestone is done', () => {
    const sailed = new Date('2026-10-23T08:00:00Z')
    const { departure } = journey({
      etd,
      eta,
      atd: null,
      ata: null,
      milestones: [step('vessel_departed', sailed)],
    })
    expect(departure).toEqual({ actual: true, at: sailed })
  })

  it('reads the job columns first, and the demo codes case-insensitively', () => {
    const atd = new Date('2026-10-22T00:00:00Z')
    const landed = new Date('2026-11-09T00:00:00Z')
    const { departure, arrival } = journey({
      etd,
      eta,
      atd,
      ata: null,
      milestones: [step('SAILED', new Date('2026-10-24T00:00:00Z')), step('ARRIVED', landed)],
    })
    expect(departure).toEqual({ actual: true, at: atd })
    expect(arrival).toEqual({ actual: true, at: landed })
  })
})
