/**
 * Has it left, has it landed — NEW-7.
 *
 * The shipment view printed `etd` under "Departed", so a customer read
 * "DEPARTED 21 Oct" about a vessel still at the quay. A planned date is a
 * forecast and must say so; "Departed" and "Arrived" are claims of fact and
 * need an actual date behind them.
 *
 * The actual date comes from the job's `atd`/`ata` columns where something
 * filled them, and otherwise from the departure or arrival milestone, which is
 * what a coordinator or the carrier feed actually completes (`jobs.atd` has no
 * writer in the application, see `apps/service/src/pdf/job-documents.ts`).
 * Only the milestones the customer is shown are consulted, so the label can
 * never disagree with the timeline drawn under it. The demo seed's
 * `SAILED`/`ARRIVED` and the pilot fixtures' `departed_origin`/`uplifted`/
 * `arrived_destination` are the same steps under other names.
 */

import type { TrackingResult } from '@/lib/pilot/types'

const DEPARTURE = new Set([
  'vessel_departed',
  'flight_departed',
  'sailed',
  'departed_origin',
  'uplifted',
])
const ARRIVAL = new Set(['vessel_arrived', 'flight_arrived', 'arrived', 'arrived_destination'])

export interface JourneyEnd {
  /** True when `at` is an actual date, false when it is the plan. */
  readonly actual: boolean
  readonly at: Date | null
}

function actualOf(
  milestones: TrackingResult['milestones'],
  codes: ReadonlySet<string>,
): Date | null {
  for (const m of milestones) {
    if (m.actualAt && codes.has(m.code.toLowerCase())) return m.actualAt
  }
  return null
}

export function journey(
  result: Pick<TrackingResult, 'etd' | 'eta' | 'atd' | 'ata' | 'milestones'>,
): { departure: JourneyEnd; arrival: JourneyEnd } {
  const departed = result.atd ?? actualOf(result.milestones, DEPARTURE)
  const arrived = result.ata ?? actualOf(result.milestones, ARRIVAL)
  return {
    departure: departed ? { actual: true, at: departed } : { actual: false, at: result.etd },
    arrival: arrived ? { actual: true, at: arrived } : { actual: false, at: result.eta },
  }
}
