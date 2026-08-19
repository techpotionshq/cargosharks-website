/**
 * DCSA Track & Trace 2.2, translated to ours — the pure half of carrier-direct.
 *
 * Sits beside `carrier-events.ts` rather than inside it, and for a reason that
 * is about shape rather than tidiness. That file maps a *string* — one
 * provider event name to one milestone code — because Terminal49 and Vizion
 * both send a name. A DCSA event has no single name: what happened is the pair
 * `eventType` + the type code for that event type, and *whether it happened at
 * all* is a third field, `eventClassifierCode`. Flattening that into a
 * synthetic string first would invent a vocabulary no carrier sends and make
 * every bug a bug in the flattening.
 *
 * It obeys the same rule about not reaching for the world — no `config`
 * import, no fetch — so it runs in CI where a carrier account never could.
 * That matters more here than for most files: `discharged` starts the
 * demurrage clock (FR-JB-07), so this translation is money.
 *
 * ## Only `ACT` becomes a milestone
 *
 * DCSA classifies every event as `PLN` (planned), `EST` (estimated) or `ACT`
 * (actual). `job_milestones.actual_at` means the thing happened. Writing an
 * estimate there would put a discharge date on the board for a vessel still at
 * sea, start a free-time clock against it, and look exactly like a real one.
 *
 * The estimates are not thrown away — they are the ETA revision operations
 * currently learns about by refreshing a carrier website — but they come back
 * separately, and land on `jobs.eta` / `jobs.etd` where an estimate belongs.
 *
 * ## Transhipment: first for origin, last for destination
 *
 * A box moving Nhava Sheva → Jebel Ali → Shuwaikh is discharged twice and
 * loaded twice, and DCSA reports every one. Taking whichever arrived last in
 * the array would date the Kuwait discharge from a Jebel Ali crane.
 *
 * The rule is per-code and follows the shipment: a container leaves origin
 * once, so the **first** `PICK`/`STUF`/`GTIN`/`LOAD`/`DEPA` is the real one and
 * later ones are transhipment; it reaches destination once, so the **last**
 * `ARRI`/`DISC`/`STRP`/`GTOT`/`DROP` is the real one and earlier ones are
 * transhipment.
 *
 * Decided here rather than by asking the carrier for the transport plan and
 * reading `transportCallSequenceNumber`. Hapag-Lloyd's own documentation
 * advises trusting their website over their API, sequence numbering is one of
 * the fields that varies between the three implementations, and a rule that
 * depends on a field each carrier populates differently fails silently. The
 * first/last rule needs nothing but the timestamps, which every carrier gets
 * right because their own operations run on them.
 */

import type { CarrierMilestone } from '../ports/index'

interface DcsaLocation {
  readonly UNLocationCode?: string
  readonly locationName?: string
  readonly facilityCode?: string
}

/**
 * One DCSA event, as much of it as this system reads.
 *
 * Deliberately partial and every field optional. Three carriers implement this
 * spec at three versions — Maersk 2.2, Hapag-Lloyd 2.2.4, CMA CGM 2.2.0 — and
 * one of them ships it as beta. A type that insisted on the full schema would
 * turn a carrier's missing optional field into a parse failure for the batch.
 */
export interface DcsaEvent {
  readonly eventID?: string
  readonly eventType?: string
  readonly eventClassifierCode?: string
  readonly eventDateTime?: string
  readonly shipmentEventTypeCode?: string
  readonly transportEventTypeCode?: string
  readonly equipmentEventTypeCode?: string
  readonly equipmentReference?: string
  readonly eventLocation?: DcsaLocation
  readonly transportCall?: {
    readonly UNLocationCode?: string
    readonly location?: DcsaLocation
    readonly transportCallSequenceNumber?: number
  }
}

/** Which end of the shipment a code belongs to — see the transhipment note. */
type Side = 'origin' | 'destination'

interface Mapping {
  readonly code: string
  readonly side: Side
}

/**
 * The vocabulary, as a table and not a heuristic.
 *
 * Keyed `EVENTTYPE/CODE` because that pair is what DCSA actually sends. The
 * right-hand side is the seeded `milestone_templates.code` vocabulary in lower
 * snake case — `discharged`, `vessel_departed`, `gate_out` — which is the
 * mistake `carrier-events.ts` records making the first time: invented codes
 * match no template, every event is dropped with a reason, and the integration
 * looks wired up while delivering nothing.
 *
 * Codes deliberately absent, each because it has no seeded template and a
 * milestone without one has no sequence, no owner and no visibility rule:
 * `EQUIPMENT/INSP` (inspected), `EQUIPMENT/RSEA` (resealed), `EQUIPMENT/RMVD`
 * (removed), and every `SHIPMENT` code except `CONF`. Adding one means adding
 * a template first.
 */
const EVENT_MAP: Readonly<Record<string, Mapping>> = {
  // --- booking ---
  'SHIPMENT/CONF': { code: 'booking_confirmed', side: 'origin' },

  // --- origin ---
  'EQUIPMENT/PICK': { code: 'empty_picked_up', side: 'origin' },
  'EQUIPMENT/STUF': { code: 'stuffed', side: 'origin' },
  'EQUIPMENT/GTIN': { code: 'gate_in', side: 'origin' },
  'EQUIPMENT/LOAD': { code: 'loaded', side: 'origin' },
  'TRANSPORT/DEPA': { code: 'vessel_departed', side: 'origin' },

  // --- destination ---
  'TRANSPORT/ARRI': { code: 'vessel_arrived', side: 'destination' },
  'EQUIPMENT/DISC': { code: 'discharged', side: 'destination' },
  'EQUIPMENT/STRP': { code: 'devanned', side: 'destination' },
  'EQUIPMENT/GTOT': { code: 'gate_out', side: 'destination' },
  'EQUIPMENT/DROP': { code: 'empty_returned', side: 'destination' },
}

/** The carrier's current estimates, for `jobs.etd` / `jobs.eta`. */
export interface CarrierEstimates {
  readonly etd?: Date
  readonly eta?: Date
}

export interface DcsaReading {
  readonly milestones: CarrierMilestone[]
  readonly estimates: CarrierEstimates
  /** Event kinds this build does not understand, for the log. */
  readonly unmapped: string[]
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** A trailing `Z`, `+03:00` or `+0300` — the part that places a time on Earth. */
const ZONE_DESIGNATOR = /(?:Z|[+-]\d{2}:?\d{2})$/i

/**
 * Read a carrier's timestamp as an instant, or `undefined` if it is not one.
 *
 * The subtle case, and the reason this is not just `new Date(value)`. DCSA
 * documents `eventDateTime` as *"the local date and time, where the event took
 * place"* — Maersk's own example is `2019-11-12T07:41:00+08:00`, an offset
 * that says which local. The schema requires one.
 *
 * When one is missing, JavaScript reads a bare `2019-11-12T07:41:00` as the
 * *server's* local time. That is the one interpretation guaranteed to be
 * wrong: the server's offset has nothing to do with the port's, and the same
 * payload would then mean different instants on a laptop in Kuwait and a
 * container running UTC. Free time is counted in whole days from these
 * timestamps (FR-JB-07), so a three-hour shift moves a discharge across
 * midnight and bills a day that was never owed.
 *
 * So a bare timestamp is read as UTC. Not because it is right — nothing here
 * can know the port's offset — but because it is *deterministic*, and a
 * discrepancy every deployment shares is one somebody can find. A discrepancy
 * that depends on which machine ran the poll is not.
 */
function instantFrom(value: string | undefined): Date | undefined {
  if (!value) return undefined

  const stamped = ZONE_DESIGNATOR.test(value) ? value : `${value}Z`
  const instant = new Date(stamped)

  return Number.isNaN(instant.getTime()) ? undefined : instant
}

/**
 * Where the event happened, in whichever field this carrier used.
 *
 * A UN/LOCODE is preferred over a name because it is the same five characters
 * in every carrier's answer and in ours, and because `KWSWK` survives being
 * read in an Arabic interface in a way that "Shuwaikh Port" does not.
 */
function locationOf(event: DcsaEvent): string | undefined {
  return (
    text(event.eventLocation?.UNLocationCode) ??
    text(event.transportCall?.UNLocationCode) ??
    text(event.transportCall?.location?.UNLocationCode) ??
    text(event.eventLocation?.locationName)
  )
}

/** The `EVENTTYPE/CODE` key, or undefined when the event names neither. */
function keyOf(event: DcsaEvent): string | undefined {
  const type = text(event.eventType)?.toUpperCase()
  if (!type) return undefined

  const code = text(
    type === 'EQUIPMENT'
      ? event.equipmentEventTypeCode
      : type === 'TRANSPORT'
        ? event.transportEventTypeCode
        : event.shipmentEventTypeCode,
  )?.toUpperCase()

  return code ? `${type}/${code}` : undefined
}

/**
 * Read a carrier's event list into milestones and estimates.
 *
 * Never throws. A carrier is entitled to send a shape we have not seen — one
 * of the three is beta — and a poll worker that threw on the twentieth event
 * of a batch would lose the nineteen that parsed. Anything unreadable becomes
 * a line in `unmapped`, which is data the caller can log.
 */
export function readDcsaEvents(events: readonly DcsaEvent[]): DcsaReading {
  /* Per code, because the first/last rule is decided per code, not per batch. */
  const chosen = new Map<string, { milestone: CarrierMilestone; side: Side }>()
  const unmapped: string[] = []
  let etd: Date | undefined
  let eta: Date | undefined

  for (const event of events) {
    const key = keyOf(event)

    if (!key) {
      unmapped.push('event with no type code')
      continue
    }

    const occurredAt = instantFrom(text(event.eventDateTime))

    /*
      An unparseable timestamp is dropped, not defaulted to now.

      The same call `carrier-events.ts` makes, for the same reason: free time
      and demurrage are counted from these dates (FR-JB-07), so a milestone
      dated "now" because its timestamp was malformed bills the customer
      wrongly and looks entirely plausible on the screen.
    */
    if (!occurredAt) {
      unmapped.push(`${key} (bad timestamp: ${event.eventDateTime ?? 'absent'})`)
      continue
    }

    /*
      A carrier that omits the classifier is read as actual.

      DCSA makes the field mandatory, so this is the beta case rather than the
      normal one — and `ACT` is the reading that matches what the other two
      carriers send for the same event. The alternative, dropping it, loses a
      real discharge because a field was missing.
    */
    const classifier = text(event.eventClassifierCode)?.toUpperCase() ?? 'ACT'

    if (classifier !== 'ACT') {
      /*
        An estimate, which is a fact about the future and not a milestone.

        Earliest departure and latest arrival, matching the transhipment rule
        below: the vessel leaves origin once and reaches destination once, and
        the legs in between are somebody else's port.
      */
      if (key === 'TRANSPORT/DEPA' && (!etd || occurredAt < etd)) etd = occurredAt
      if (key === 'TRANSPORT/ARRI' && (!eta || occurredAt > eta)) eta = occurredAt
      continue
    }

    const mapping = EVENT_MAP[key]

    if (!mapping) {
      unmapped.push(key)
      continue
    }

    const milestone: CarrierMilestone = {
      code: mapping.code,
      occurredAt,
      location: locationOf(event),
    }

    const held = chosen.get(mapping.code)

    if (!held) {
      chosen.set(mapping.code, { milestone, side: mapping.side })
      continue
    }

    const preferNew =
      mapping.side === 'origin'
        ? occurredAt < held.milestone.occurredAt
        : occurredAt > held.milestone.occurredAt

    if (preferNew) chosen.set(mapping.code, { milestone, side: mapping.side })
  }

  const milestones = [...chosen.values()].map((held) => held.milestone)

  // Oldest first: the trail is read as a sequence, and a carrier that answers
  // newest-first would otherwise write the job's history backwards.
  milestones.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  return { milestones, estimates: { etd, eta }, unmapped }
}
