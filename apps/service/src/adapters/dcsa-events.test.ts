/**
 * The DCSA translation — the half of carrier-direct that can be wrong quietly.
 *
 * The HTTP is unremarkable and fails loudly. What decides whether a demurrage
 * clock starts on the right day is this file's subject: which of four
 * discharges was the Kuwait one, and whether an estimate was mistaken for a
 * fact. Both of those look like ordinary data on the screen.
 *
 * Tested against the published event model rather than a live carrier, which
 * is also what makes the tests worth keeping: they run in CI on every commit,
 * where three carrier accounts never could.
 */

import { describe, expect, it } from 'vitest'
import { readDcsaEvents, type DcsaEvent } from './dcsa-events'

const equipment = (code: string, at: string, location?: string, classifier = 'ACT'): DcsaEvent => ({
  eventType: 'EQUIPMENT',
  eventClassifierCode: classifier,
  equipmentEventTypeCode: code,
  eventDateTime: at,
  ...(location ? { eventLocation: { UNLocationCode: location } } : {}),
})

const transport = (code: string, at: string, location?: string, classifier = 'ACT'): DcsaEvent => ({
  eventType: 'TRANSPORT',
  eventClassifierCode: classifier,
  transportEventTypeCode: code,
  eventDateTime: at,
  ...(location ? { transportCall: { UNLocationCode: location } } : {}),
})

describe('DCSA event translation', () => {
  it('maps the container vocabulary onto the seeded milestone codes', () => {
    const { milestones, unmapped } = readDcsaEvents([
      equipment('PICK', '2026-07-20T06:00:00Z', 'INNSA'),
      equipment('STUF', '2026-07-21T09:00:00Z', 'INNSA'),
      equipment('GTIN', '2026-07-22T05:30:00Z', 'INNSA'),
      equipment('LOAD', '2026-07-23T14:00:00Z', 'INNSA'),
      transport('DEPA', '2026-07-24T02:00:00Z', 'INNSA'),
      transport('ARRI', '2026-08-13T18:00:00Z', 'KWSWK'),
      equipment('DISC', '2026-08-14T11:02:00Z', 'KWSWK'),
      equipment('GTOT', '2026-08-16T07:45:00Z', 'KWSWK'),
      equipment('DROP', '2026-08-20T10:00:00Z', 'KWSWK'),
    ])

    expect(unmapped).toEqual([])
    expect(milestones.map((m) => m.code)).toEqual([
      'empty_picked_up',
      'stuffed',
      'gate_in',
      'loaded',
      'vessel_departed',
      'vessel_arrived',
      'discharged',
      'gate_out',
      'empty_returned',
    ])
    expect(milestones.at(-1)?.location).toBe('KWSWK')
  })

  it('reads a booking confirmation, and no other shipment lifecycle event', () => {
    const { milestones, unmapped } = readDcsaEvents([
      {
        eventType: 'SHIPMENT',
        eventClassifierCode: 'ACT',
        shipmentEventTypeCode: 'CONF',
        eventDateTime: '2026-07-18T08:00:00Z',
      },
      {
        eventType: 'SHIPMENT',
        eventClassifierCode: 'ACT',
        shipmentEventTypeCode: 'DRFT',
        eventDateTime: '2026-07-17T08:00:00Z',
      },
    ])

    expect(milestones.map((m) => m.code)).toEqual(['booking_confirmed'])
    expect(unmapped).toEqual(['SHIPMENT/DRFT'])
  })

  /**
   * The assertion the demurrage clock hangs off.
   *
   * Nhava Sheva → Jebel Ali → Shuwaikh is discharged twice. Taking whichever
   * the carrier listed last, or first, would date the Kuwait discharge from a
   * Jebel Ali crane — a fortnight of free time counted from the wrong port,
   * on a screen where it looks entirely correct.
   */
  it('takes the last discharge and the first departure through a transhipment', () => {
    const { milestones } = readDcsaEvents([
      transport('DEPA', '2026-07-24T02:00:00Z', 'INNSA'),
      equipment('DISC', '2026-08-02T09:00:00Z', 'AEJEA'),
      equipment('LOAD', '2026-08-04T16:00:00Z', 'AEJEA'),
      transport('DEPA', '2026-08-05T01:00:00Z', 'AEJEA'),
      equipment('DISC', '2026-08-14T11:02:00Z', 'KWSWK'),
    ])

    const by = Object.fromEntries(milestones.map((m) => [m.code, m]))

    expect(by.discharged?.location).toBe('KWSWK')
    expect(by.discharged?.occurredAt.toISOString()).toBe('2026-08-14T11:02:00.000Z')
    expect(by.vessel_departed?.location).toBe('INNSA')
    expect(by.vessel_departed?.occurredAt.toISOString()).toBe('2026-07-24T02:00:00.000Z')
  })

  it('reports one milestone per code however many legs the carrier sent', () => {
    const { milestones } = readDcsaEvents([
      equipment('DISC', '2026-08-02T09:00:00Z', 'AEJEA'),
      equipment('DISC', '2026-08-09T09:00:00Z', 'OMSOH'),
      equipment('DISC', '2026-08-14T11:02:00Z', 'KWSWK'),
    ])

    expect(milestones).toHaveLength(1)
  })

  /**
   * The other assertion that matters most.
   *
   * `job_milestones.actual_at` means the thing happened. An estimate written
   * there would put a discharge on the board for a vessel still at sea and
   * start a free-time clock against it.
   */
  it('refuses to turn an estimate into a milestone', () => {
    const { milestones, estimates } = readDcsaEvents([
      transport('ARRI', '2026-08-13T18:00:00Z', 'KWSWK', 'EST'),
      equipment('DISC', '2026-08-14T11:00:00Z', 'KWSWK', 'PLN'),
    ])

    expect(milestones).toEqual([])
    expect(estimates.eta?.toISOString()).toBe('2026-08-13T18:00:00.000Z')
  })

  it('keeps the last estimated arrival and the first estimated departure', () => {
    const { estimates } = readDcsaEvents([
      transport('DEPA', '2026-07-24T02:00:00Z', 'INNSA', 'EST'),
      transport('ARRI', '2026-08-02T06:00:00Z', 'AEJEA', 'EST'),
      transport('DEPA', '2026-08-05T01:00:00Z', 'AEJEA', 'EST'),
      transport('ARRI', '2026-08-13T18:00:00Z', 'KWSWK', 'EST'),
    ])

    expect(estimates.etd?.toISOString()).toBe('2026-07-24T02:00:00.000Z')
    expect(estimates.eta?.toISOString()).toBe('2026-08-13T18:00:00.000Z')
  })

  /**
   * A milestone dated "now" because its timestamp was malformed is worse than
   * a missing one: free time is counted from these dates (FR-JB-07), so a
   * wrong date bills the customer wrongly and looks entirely plausible.
   */
  it('drops an unparseable timestamp rather than defaulting it to now', () => {
    const { milestones, unmapped } = readDcsaEvents([
      equipment('DISC', 'yesterday afternoon', 'KWSWK'),
    ])

    expect(milestones).toEqual([])
    expect(unmapped[0]).toContain('EQUIPMENT/DISC')
  })

  /**
   * A carrier adding an event type must never be absorbed into whichever of
   * our codes it happens to resemble. `INSP` has no seeded template — no
   * sequence, no owner, no visibility rule — so a milestone for it would sit
   * on the board belonging to nobody.
   */
  it('records an unknown code rather than mapping it to something adjacent', () => {
    const { milestones, unmapped } = readDcsaEvents([
      equipment('INSP', '2026-08-14T11:00:00Z'),
      equipment('RSEA', '2026-08-14T12:00:00Z'),
    ])

    expect(milestones).toEqual([])
    expect(unmapped).toEqual(['EQUIPMENT/INSP', 'EQUIPMENT/RSEA'])
  })

  it('reads a carrier that omits the classifier as having meant actual', () => {
    const { milestones } = readDcsaEvents([
      {
        eventType: 'EQUIPMENT',
        equipmentEventTypeCode: 'DISC',
        eventDateTime: '2026-08-14T11:02:00Z',
      },
    ])

    expect(milestones.map((m) => m.code)).toEqual(['discharged'])
  })

  it('is indifferent to the case a carrier sends its codes in', () => {
    const { milestones } = readDcsaEvents([
      {
        eventType: 'equipment',
        eventClassifierCode: 'act',
        equipmentEventTypeCode: 'disc',
        eventDateTime: '2026-08-14T11:02:00Z',
      },
    ])

    expect(milestones.map((m) => m.code)).toEqual(['discharged'])
  })

  it('finds the location wherever in the event a carrier put it', () => {
    const [fromTransportCall] = readDcsaEvents([
      {
        eventType: 'TRANSPORT',
        eventClassifierCode: 'ACT',
        transportEventTypeCode: 'ARRI',
        eventDateTime: '2026-08-13T18:00:00Z',
        transportCall: { location: { UNLocationCode: 'KWSWK' } },
      },
    ]).milestones

    expect(fromTransportCall?.location).toBe('KWSWK')

    const [byName] = readDcsaEvents([
      {
        eventType: 'EQUIPMENT',
        eventClassifierCode: 'ACT',
        equipmentEventTypeCode: 'GTOT',
        eventDateTime: '2026-08-16T07:45:00Z',
        eventLocation: { locationName: 'Shuwaikh Port' },
      },
    ]).milestones

    expect(byName?.location).toBe('Shuwaikh Port')
  })

  /**
   * A poll worker that threw on the twentieth event of a batch would lose the
   * nineteen that parsed. One of the three carriers ships this API as beta.
   */
  it('survives an event shaped in a way no carrier documents', () => {
    const { milestones, unmapped } = readDcsaEvents([
      {} as DcsaEvent,
      { eventType: 'EQUIPMENT' } as DcsaEvent,
      equipment('DISC', '2026-08-14T11:02:00Z', 'KWSWK'),
    ])

    expect(milestones.map((m) => m.code)).toEqual(['discharged'])
    expect(unmapped).toHaveLength(2)
  })

  it('returns the trail oldest first, whatever order the carrier answered in', () => {
    const { milestones } = readDcsaEvents([
      equipment('GTOT', '2026-08-16T07:45:00Z'),
      equipment('DISC', '2026-08-14T11:02:00Z'),
      transport('DEPA', '2026-07-24T02:00:00Z'),
    ])

    expect(milestones.map((m) => m.code)).toEqual(['vessel_departed', 'discharged', 'gate_out'])
  })
})
