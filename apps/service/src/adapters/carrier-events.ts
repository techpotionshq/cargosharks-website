/**
 * Carrier event vocabulary, translated to ours — the pure half of tracking.
 *
 * Separate from `carrier-tracking.ts` for a reason the first test run made
 * plain: that module imports `config`, which validates the environment at
 * module load and calls `process.exit(1)` when it is unset. So importing the
 * mapper to test it killed the test runner — the pure logic could not be
 * exercised because it shared a file with the I/O.
 *
 * Which is the argument this codebase already makes about `packages/core`:
 * *"pure domain. imports nothing. no I/O, no DB, no framework."* This is not
 * domain — a vendor's spelling of "discharged" is integration detail, not a
 * fact about forwarding — so it stays in `service`. But it obeys the same rule
 * about not reaching for the world, and that is what makes it testable in CI
 * where a live provider account could never be.
 */

import type { CarrierMilestone } from '../ports/index'

/**
 * Provider event vocabulary to ours.
 *
 * Deliberately a table and not a heuristic. A `startsWith` or a fuzzy match
 * would silently absorb a new event type from the provider into whichever of
 * our codes it happened to resemble, and the first sign would be an SLA that
 * stopped for the wrong reason.
 *
 * The keys are the union used by the container-visibility providers a mid
 * market forwarder would actually buy — Terminal49, Vizion, Portcast. They
 * agree on more than they differ on because they are all reading the same
 * carrier EDI underneath.
 */
const EVENT_MAP: Readonly<Record<string, string>> = {
  // Origin
  empty_out: 'EMPTY_DISPATCHED',
  container_empty_out: 'EMPTY_DISPATCHED',
  gate_in: 'GATE_IN_ORIGIN',
  full_in: 'GATE_IN_ORIGIN',
  container_gate_in: 'GATE_IN_ORIGIN',
  loaded_on_vessel: 'LOADED',
  vessel_loaded: 'LOADED',
  // Main carriage
  vessel_departed: 'DEPARTED',
  departure: 'DEPARTED',
  transhipment_loaded: 'TRANSHIPPED',
  transshipment_loaded: 'TRANSHIPPED',
  vessel_arrived: 'ARRIVED',
  arrival: 'ARRIVED',
  // Destination
  vessel_discharged: 'DISCHARGED',
  discharged: 'DISCHARGED',
  container_discharged: 'DISCHARGED',
  available_for_pickup: 'AVAILABLE',
  gate_out: 'GATE_OUT_DESTINATION',
  container_gate_out: 'GATE_OUT_DESTINATION',
  empty_returned: 'EMPTY_RETURNED',
  container_empty_return: 'EMPTY_RETURNED',
}

export interface ProviderEvent {
  readonly event: string
  readonly timestamp: string
  readonly location?: string
}

export interface MappedEvents {
  readonly milestones: CarrierMilestone[]
  /** Provider codes this build does not understand, for the log. */
  readonly unmapped: string[]
}

/**
 * The pure half, separated so it can be tested without a provider account.
 *
 * This is where the risk lives — the HTTP is unremarkable and the translation
 * is what decides whether a shipment's clock stops — so it is the half that
 * has tests.
 */
export function mapProviderEvents(events: readonly ProviderEvent[]): MappedEvents {
  const milestones: CarrierMilestone[] = []
  const unmapped: string[] = []

  for (const event of events) {
    const code = EVENT_MAP[event.event.toLowerCase().trim()]

    if (!code) {
      unmapped.push(event.event)
      continue
    }

    const occurredAt = new Date(event.timestamp)
    /*
      An unparseable timestamp is dropped, not defaulted to now.

      A milestone dated "now" because its timestamp was malformed is worse
      than a missing one: free time and demurrage are counted from these
      dates (FR-JB-07), so a wrong date bills the customer wrongly and looks
      entirely plausible on the screen.
    */
    if (Number.isNaN(occurredAt.getTime())) {
      unmapped.push(`${event.event} (bad timestamp: ${event.timestamp})`)
      continue
    }

    milestones.push({ code, occurredAt, location: event.location })
  }

  // Oldest first: the milestone trail is read as a sequence, and a provider
  // that answers newest-first would otherwise write the job's history
  // backwards.
  milestones.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  return { milestones, unmapped }
}
