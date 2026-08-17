/**
 * The carrier event mapping — the half of tracking that can be wrong quietly.
 *
 * The HTTP is unremarkable and fails loudly. The translation from a provider's
 * event vocabulary to *our* milestone codes is what decides whether an SLA
 * clock stops, whether a job leaves the exception board, and whether free time
 * is counted from the right date (FR-JB-07) — and every one of those failures
 * looks like ordinary data on the screen.
 *
 * So this is tested without a provider account, which is also what makes the
 * tests worth keeping: they run in CI on every commit, where a live API could
 * not.
 */

import { describe, expect, it } from 'vitest'
import { mapProviderEvents, type ProviderEvent } from './carrier-events'

const at = (iso: string): string => iso

describe('carrier event mapping', () => {
  it('translates a provider vocabulary to milestone codes', () => {
    const { milestones, unmapped } = mapProviderEvents([
      { event: 'vessel_departed', timestamp: at('2026-08-01T06:00:00Z'), location: 'AEJEA' },
      { event: 'vessel_discharged', timestamp: at('2026-08-14T11:00:00Z'), location: 'KWSWK' },
    ])

    expect(unmapped).toEqual([])
    expect(milestones.map((m) => m.code)).toEqual(['DEPARTED', 'DISCHARGED'])
    expect(milestones[0]!.location).toBe('AEJEA')
  })

  /**
   * Providers disagree on spelling and agree on meaning, because they are all
   * reading the same carrier EDI underneath. The synonym rows are the only
   * reason a real file imports at all.
   */
  it('accepts the synonyms different providers use for one event', () => {
    for (const spelling of ['vessel_discharged', 'discharged', 'container_discharged']) {
      const { milestones } = mapProviderEvents([
        { event: spelling, timestamp: at('2026-08-14T11:00:00Z') },
      ])
      expect(milestones[0]?.code, spelling).toBe('DISCHARGED')
    }
  })

  it('is indifferent to case and surrounding space', () => {
    const { milestones } = mapProviderEvents([
      { event: '  Vessel_Departed ', timestamp: at('2026-08-01T06:00:00Z') },
    ])
    expect(milestones[0]?.code).toBe('DEPARTED')
  })

  /**
   * The assertion that matters most.
   *
   * A provider adding an event type must never be absorbed into whichever of
   * our codes it happens to resemble — a `startsWith` or a fuzzy match would
   * stop an SLA clock for the wrong reason, and the first sign would be a
   * board that quietly got shorter.
   */
  it('drops unknown codes rather than guessing', () => {
    const { milestones, unmapped } = mapProviderEvents([
      { event: 'vessel_berthed_awaiting_pilot', timestamp: at('2026-08-13T02:00:00Z') },
      { event: 'vessel_departed', timestamp: at('2026-08-01T06:00:00Z') },
    ])

    expect(milestones.map((m) => m.code)).toEqual(['DEPARTED'])
    expect(unmapped).toEqual(['vessel_berthed_awaiting_pilot'])
  })

  /**
   * A malformed timestamp is dropped, never defaulted to now.
   *
   * Demurrage and detention are counted from these dates. A milestone dated
   * "now" because its timestamp was unparseable bills the customer wrongly and
   * looks entirely reasonable on the job.
   */
  it('refuses an event whose timestamp will not parse', () => {
    const { milestones, unmapped } = mapProviderEvents([
      { event: 'gate_out', timestamp: 'not a date' },
    ])

    expect(milestones).toEqual([])
    expect(unmapped[0]).toMatch(/bad timestamp/)
  })

  /**
   * The trail is read as a sequence, so a provider answering newest-first must
   * not write the job's history backwards.
   */
  it('orders milestones oldest first whatever the provider sent', () => {
    const newestFirst: ProviderEvent[] = [
      { event: 'empty_returned', timestamp: at('2026-08-20T09:00:00Z') },
      { event: 'gate_out', timestamp: at('2026-08-16T09:00:00Z') },
      { event: 'vessel_departed', timestamp: at('2026-08-01T06:00:00Z') },
    ]

    const { milestones } = mapProviderEvents(newestFirst)

    expect(milestones.map((m) => m.code)).toEqual([
      'DEPARTED',
      'GATE_OUT_DESTINATION',
      'EMPTY_RETURNED',
    ])
  })

  it('returns nothing for an empty feed rather than failing', () => {
    expect(mapProviderEvents([])).toEqual({ milestones: [], unmapped: [] })
  })
})

/**
 * Terminal49's own event names, which are namespaced.
 *
 * Recorded from the provider's documented webhook payloads rather than
 * invented — the first version of this adapter mapped `vessel_departed` and
 * called an endpoint that does not exist, both inferred from the shape of our
 * own port. The provider decides its vocabulary; we only decide the mapping.
 */
describe('Terminal49 webhook event names', () => {
  it('maps the namespaced form the webhook actually sends', () => {
    const { milestones, unmapped } = mapProviderEvents([
      {
        event: 'container.transport.vessel_departed',
        timestamp: '2026-08-01T06:00:00Z',
        location: 'AEJEA',
      },
      { event: 'container.transport.vessel_discharged', timestamp: '2026-08-14T11:00:00Z' },
      { event: 'container.transport.full_out', timestamp: '2026-08-16T08:00:00Z' },
      { event: 'container.transport.empty_in', timestamp: '2026-08-20T10:00:00Z' },
    ])

    expect(unmapped).toEqual([])
    expect(milestones.map((m) => m.code)).toEqual([
      'DEPARTED',
      'DISCHARGED',
      'GATE_OUT_DESTINATION',
      'EMPTY_RETURNED',
    ])
  })

  /** A polling provider's bare verb still maps to the same milestone. */
  it('agrees with the bare form a polling provider sends', () => {
    const dotted = mapProviderEvents([
      { event: 'container.transport.vessel_departed', timestamp: '2026-08-01T06:00:00Z' },
    ])
    const bare = mapProviderEvents([
      { event: 'vessel_departed', timestamp: '2026-08-01T06:00:00Z' },
    ])

    expect(dotted.milestones[0]?.code).toBe(bare.milestones[0]?.code)
  })

  /**
   * Terminal49 sends lifecycle events that are not shipment milestones —
   * `tracking_request.succeeded` says our submission resolved, not that
   * anything happened to the cargo. Writing it onto the job would put a
   * milestone on the board that no operator could explain.
   */
  it('ignores tracking-request lifecycle events', () => {
    const { milestones, unmapped } = mapProviderEvents([
      { event: 'tracking_request.succeeded', timestamp: '2026-08-01T06:00:00Z' },
      { event: 'tracking_request.failed', timestamp: '2026-08-01T06:00:00Z' },
    ])

    expect(milestones).toEqual([])
    expect(unmapped).toEqual(['tracking_request.succeeded', 'tracking_request.failed'])
  })
})
