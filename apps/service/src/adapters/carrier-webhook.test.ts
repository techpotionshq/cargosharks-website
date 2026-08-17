/**
 * Reading a Terminal49 webhook.
 *
 * The payloads here follow the provider's documented shape. They are not
 * recorded from a live push — a free plan cannot register a webhook endpoint
 * (`401`: *"You do not have permissions for using the API, except for creating
 * tracking requests"*) — so what these tests prove is that the reader handles
 * the documented shape and every degenerate case around it. When a paid key
 * exists, the first real payload should be pasted in here as a fixture.
 *
 * Said plainly because the distinction matters: this is defence against our
 * own mistakes, not evidence that the provider sends what we think.
 */

import { describe, expect, it } from 'vitest'
import { readCarrierWebhook, type Terminal49Webhook } from './carrier-webhook'

/** The documented envelope: a notification, with its subject in `included`. */
const webhook = (
  event: string,
  container: Record<string, unknown>,
  deliveredAt = '2026-08-20T12:00:00Z',
): Terminal49Webhook => ({
  data: {
    id: 'evt-0001',
    type: 'webhook_notification',
    attributes: { event, delivered_at: deliveredAt },
  },
  included: [{ type: 'container', id: 'c-1', attributes: container }],
})

describe('reading a carrier webhook', () => {
  it('extracts the milestone, our reference and the location', () => {
    const result = readCarrierWebhook(
      webhook('container.transport.vessel_discharged', {
        number: 'MSCU1234567',
        ref_numbers: ['KWI-JOB-0001'],
        bill_of_lading_number: 'MEDUQ7654321',
        timestamp: '2026-08-14T11:00:00Z',
        location_locode: 'KWSWK',
      }),
    )

    expect(result.milestone?.code).toBe('discharged')
    expect(result.jobReference).toBe('KWI-JOB-0001')
    expect(result.billOfLading).toBe('MEDUQ7654321')
    expect(result.milestone?.location).toBe('KWSWK')
    expect(result.milestone?.occurredAt.toISOString()).toBe('2026-08-14T11:00:00.000Z')
  })

  /**
   * The event's own timestamp, never the delivery time.
   *
   * A redelivery after an outage carries today's `delivered_at` for something
   * that happened last week. Free time and demurrage are counted from these
   * dates (FR-JB-07), so the difference between the two is money.
   */
  it('prefers the event timestamp over the delivery time', () => {
    const result = readCarrierWebhook(
      webhook(
        'container.transport.vessel_departed',
        { number: 'MSCU1234567', timestamp: '2026-08-01T06:00:00Z' },
        '2026-08-25T09:00:00Z', // redelivered three weeks later
      ),
    )

    expect(result.milestone?.occurredAt.toISOString()).toBe('2026-08-01T06:00:00.000Z')
  })

  /**
   * Lifecycle events are not milestones.
   *
   * `tracking_request.succeeded` says our submission resolved — nothing
   * happened to the cargo. Writing it onto a job would put a milestone on the
   * board that no operator could explain.
   */
  it('refuses a lifecycle event with a reason', () => {
    const result = readCarrierWebhook({
      data: {
        id: 'evt-0002',
        attributes: { event: 'tracking_request.succeeded', delivered_at: '2026-08-20T12:00:00Z' },
      },
    })

    expect(result.milestone).toBeUndefined()
    expect(result.reason).toMatch(/unmapped/)
  })

  /**
   * Never throws, for any shape.
   *
   * A webhook route that throws answers 500, and every provider reads 500 as
   * "retry" — so an unparseable payload would redeliver forever. The refusal
   * has to be data the caller can record and acknowledge.
   */
  it.each([
    ['an empty object', {}],
    ['no data', { included: [] }],
    ['no event name', { data: { id: 'x', attributes: {} } }],
    ['no subject', { data: { id: 'x', attributes: { event: 'container.transport.full_out' } } }],
  ])('survives %s without throwing', (_label, body) => {
    const result = readCarrierWebhook(body as Terminal49Webhook)
    expect(result.milestone).toBeUndefined()
    expect(result.reason).toBeDefined()
  })

  it('refuses an event that carries no timestamp anywhere', () => {
    const result = readCarrierWebhook({
      data: { id: 'evt-3', attributes: { event: 'container.transport.full_out' } },
      included: [{ type: 'container', attributes: { number: 'MSCU1234567' } }],
    })

    expect(result.milestone).toBeUndefined()
    expect(result.reason).toMatch(/no timestamp/)
  })

  /**
   * A container number is not a bill of lading.
   *
   * When the provider sends only `number`, it is used for both — but the
   * worker tries the job reference first and treats a multi-row match as no
   * match, which is what keeps a reused container from attaching an event to
   * last month's shipment.
   */
  it('does not invent a bill of lading it was not given', () => {
    const result = readCarrierWebhook(
      webhook('container.transport.empty_in', {
        number: 'MSCU1234567',
        timestamp: '2026-08-20T10:00:00Z',
      }),
    )

    expect(result.containerNumber).toBe('MSCU1234567')
    expect(result.jobReference).toBeUndefined()
  })

  it('ignores blank reference numbers rather than treating them as a match', () => {
    const result = readCarrierWebhook(
      webhook('container.transport.vessel_arrived', {
        number: 'MSCU1234567',
        ref_numbers: ['   '],
        timestamp: '2026-08-13T02:00:00Z',
      }),
    )

    expect(result.jobReference).toBeUndefined()
    expect(result.milestone?.code).toBe('vessel_arrived')
  })
})
