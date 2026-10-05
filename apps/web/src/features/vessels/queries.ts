/**
 * Vessel positions, read for the job file, the portal and the board.
 *
 * Two reads, each with its fixture branch. Both run under the person's own
 * actor, and `vessel_positions_read` (0070) does the scoping: a vessel is
 * visible exactly when a job sailing on it is. Nothing here filters by branch
 * or customer, for the same reason no other slice does.
 */

import 'server-only'
import {
  livePositionsForBoard,
  vesselForJob,
  withActor,
  type Actor,
  type BoardVesselPosition,
  type JobVessel,
} from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotBoardVessels, pilotJobVessel } from '@/lib/pilot/vessels'

const SEA_MODES = new Set(['sea_fcl', 'sea_lcl'])

/**
 * One job's vessel and its last fix, or undefined when there is nothing to
 * draw: the job is not visible, or it does not sail on a ship.
 */
export async function getJobVessel(actor: Actor, jobId: string): Promise<JobVessel | undefined> {
  if (usePilotFixtures()) return pilotJobVessel(jobId)

  const vessel = await withActor(actor, (tx) => vesselForJob(tx, jobId))
  return vessel && SEA_MODES.has(vessel.mode) ? vessel : undefined
}

/** Every live sea job's last known fix, for the dashboard map. */
export async function getBoardVesselPositions(actor: Actor): Promise<BoardVesselPosition[]> {
  if (usePilotFixtures()) return pilotBoardVessels()
  return withActor(actor, (tx) => livePositionsForBoard(tx))
}
