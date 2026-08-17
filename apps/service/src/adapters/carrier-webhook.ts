/**
 * Reading a Terminal49 webhook — the pure half of ingestion.
 *
 * Separate from the route and the worker for the same reason
 * `carrier-events.ts` is separate from the HTTP: this is the part that decides
 * *which job* an event belongs to, and getting that wrong writes a carrier
 * milestone onto somebody else's shipment. It has to be checkable without a
 * provider account, a database or a running server.
 *
 * ## Attribution is the whole problem
 *
 * A webhook arrives describing a container. Nothing in it knows about our job
 * numbering, so the event has to be tied back to a job by something both sides
 * hold. In order of trust:
 *
 *   1. `ref_numbers` — our own job reference, sent by us at submission and
 *      echoed back. Unambiguous, because we chose it.
 *   2. the bill of lading — matched against `jobs.master_bill_number` or
 *      `house_bill_number`. Reliable but not guaranteed unique: a house and a
 *      master bill can repeat across years and carriers.
 *   3. the container number — the weakest, because containers are reused
 *      constantly and the same box carries a different shipment next month.
 *
 * The worker tries them in that order and refuses ambiguity rather than
 * guessing. An unattributed event is logged and dropped; a *misattributed* one
 * is a shipment history that is quietly wrong, which nobody discovers until a
 * demurrage dispute.
 */

import { mapProviderEvents, type ProviderEvent } from './carrier-events'
import type { CarrierMilestone } from '../ports/index'

/**
 * Terminal49 sends JSON:API. Only the fields this system reads are declared —
 * a wider type would imply a contract we do not depend on and would break on
 * a field the provider is free to change.
 */
export interface Terminal49Webhook {
  readonly data?: {
    readonly id?: string
    readonly type?: string
    readonly attributes?: {
      readonly event?: string
      readonly delivered_at?: string
      readonly reference_type?: string
      readonly reference_id?: string
    }
  }
  readonly included?: readonly {
    readonly type?: string
    readonly id?: string
    readonly attributes?: Record<string, unknown>
  }[]
}

export interface CarrierEventEnvelope {
  /** The provider's event id, for idempotency. */
  readonly eventId: string
  readonly event: string
  /** Our job reference, when the provider echoed it back. */
  readonly jobReference?: string
  readonly billOfLading?: string
  readonly containerNumber?: string
  readonly milestone?: CarrierMilestone
  /** Why nothing usable came out, when nothing did. */
  readonly reason?: string
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Turn one webhook body into an attributable milestone, or an explained
 * refusal.
 *
 * Never throws. A provider is entitled to send a shape we do not understand,
 * and a webhook route that throws returns 500 — which every provider treats as
 * "retry", producing an infinite redelivery of a payload that will never
 * parse. The refusal is data, so the caller can record it and answer 200.
 */
export function readCarrierWebhook(body: Terminal49Webhook): CarrierEventEnvelope {
  const attributes = body.data?.attributes ?? {}
  const event = str(attributes.event) ?? ''
  const eventId = str(body.data?.id) ?? ''

  if (!event) {
    return { eventId, event: '', reason: 'no event name in payload' }
  }

  /*
    The container or shipment the event is about.

    Terminal49 puts the subject in `included` alongside the notification
    itself, so the useful identifiers are one level down rather than on `data`.
  */
  const subject = body.included?.find(
    (entry) => entry.type === 'container' || entry.type === 'shipment',
  )
  const subjectAttributes = subject?.attributes ?? {}

  const refNumbers = Array.isArray(subjectAttributes.ref_numbers)
    ? (subjectAttributes.ref_numbers as unknown[]).map((value) => str(value)).filter(Boolean)
    : []

  const envelope = {
    eventId,
    event,
    jobReference: refNumbers[0],
    billOfLading: str(subjectAttributes.bill_of_lading_number) ?? str(subjectAttributes.number),
    containerNumber: str(subjectAttributes.number),
  }

  /*
    The timestamp is the event's own, never the delivery time.

    `delivered_at` is when Terminal49 sent the notification; a redelivery
    after an outage would carry today's date for something that happened last
    week. Free time and demurrage are counted from these dates (FR-JB-07), so
    the difference is money.
  */
  const occurredAt =
    str(subjectAttributes.timestamp) ??
    str(subjectAttributes.actual_at) ??
    str(attributes.delivered_at)

  if (!occurredAt) {
    return { ...envelope, reason: `no timestamp on ${event}` }
  }

  const provider: ProviderEvent = {
    event,
    timestamp: occurredAt,
    location: str(subjectAttributes.location_locode) ?? str(subjectAttributes.port_locode),
  }

  const { milestones, unmapped } = mapProviderEvents([provider])

  if (milestones.length === 0) {
    /*
      Not an error, and deliberately not retried.

      Terminal49 sends lifecycle events — `tracking_request.succeeded` — and
      estimate revisions that are not shipment milestones. Ours is a closed
      vocabulary; anything outside it is recorded and ignored rather than
      forced into the nearest-looking code.
    */
    return { ...envelope, reason: `unmapped: ${unmapped[0] ?? event}` }
  }

  return { ...envelope, milestone: milestones[0] }
}
