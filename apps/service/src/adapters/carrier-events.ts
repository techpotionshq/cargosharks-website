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
 * ## The right-hand side is the seeded vocabulary, not one of our own
 *
 * These map onto `milestone_templates.code` — `discharged`, `vessel_departed`,
 * `gate_out` — which `db:seed` writes in lower snake case. The first version
 * of this table invented `DISCHARGED`, `DEPARTED`, `GATE_OUT_DESTINATION`,
 * which exist nowhere in the system: every event would have found no template
 * and been dropped with a reason, so the integration would have looked wired
 * up and delivered nothing. Running it against a seeded database is what
 * caught it.
 *
 * Two provider events have no seeded counterpart — transhipment loading, and
 * "available for pickup". They are deliberately absent rather than mapped to
 * something adjacent: a milestone the templates do not define has no sequence,
 * no owner and no visibility rule, and would sit on the board belonging to
 * nobody. Adding them means adding a template first.
 *
 * ## Both spellings of every event are here on purpose.
 *
 * Terminal49 pushes dotted, namespaced names —
 * `container.transport.vessel_departed`. Polling providers like Vizion answer
 * with the bare verb, `vessel_departed`. Rather than strip the namespace and
 * hope the tail is unique, both forms are listed: a namespace tells you *what
 * kind of thing* moved, and `shipment.*` versus `container.*` will not always
 * mean the same milestone as this system grows.
 *
 * Listing them costs a line each and removes a transformation that would have
 * to be right forever.
 */
const EVENT_MAP: Readonly<Record<string, string>> = {
  // --- origin ---
  empty_out: 'empty_picked_up',
  container_empty_out: 'empty_picked_up',
  'container.transport.empty_out': 'empty_picked_up',
  gate_in: 'gate_in',
  full_in: 'gate_in',
  container_gate_in: 'gate_in',
  'container.transport.full_in': 'gate_in',
  loaded_on_vessel: 'loaded',
  vessel_loaded: 'loaded',
  'container.transport.vessel_loaded': 'loaded',

  // --- main carriage ---
  vessel_departed: 'vessel_departed',
  departure: 'vessel_departed',
  'container.transport.vessel_departed': 'vessel_departed',
  vessel_arrived: 'vessel_arrived',
  arrival: 'vessel_arrived',
  'container.transport.vessel_arrived': 'vessel_arrived',

  // --- destination ---
  vessel_discharged: 'discharged',
  discharged: 'discharged',
  container_discharged: 'discharged',
  'container.transport.vessel_discharged': 'discharged',
  gate_out: 'gate_out',
  container_gate_out: 'gate_out',
  'container.transport.full_out': 'gate_out',
  empty_returned: 'empty_returned',
  container_empty_return: 'empty_returned',
  'container.transport.empty_in': 'empty_returned',
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
