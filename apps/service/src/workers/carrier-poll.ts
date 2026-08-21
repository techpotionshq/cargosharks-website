/**
 * Hourly carrier poll — the automatic half of `CarrierTracking`, FR-JB-06.
 *
 * The single most repetitive act in the business is a coordinator opening a
 * carrier website, reading "discharged 14 Aug 11:02", and typing it onto a
 * job. This asks the carrier instead.
 *
 * Shaped like `fx-refresh.ts` and for the same reason: nothing reads the feed
 * while somebody is waiting. The board renders `job_milestones`, so a slow or
 * rate-limited carrier is a monitoring problem and never an outage on a screen.
 *
 * ## Which shipments get asked about
 *
 * Open sea jobs, with a reference a carrier will recognise, whose carrier
 * partner has a SCAC this deployment holds credentials for. Every one of those
 * clauses removes a call that could only ever have failed:
 *
 *   - **Sea only.** DCSA is the *Container* Shipping Association. An air
 *     waybill is a different industry with a different feed.
 *   - **A carrier's own reference.** The booking number first, the master bill
 *     second. Never the house bill — that is our document, issued by us, and
 *     a carrier asked about one answers 404 forever, which reads on the board
 *     as a shipment nothing has happened to.
 *   - **A SCAC we can authenticate to.** Asked before calling rather than
 *     discovered from a 401, so a shipment on an unregistered carrier is a job
 *     the feed is quiet about rather than an error somebody has to triage.
 *
 * ## Soonest first, and the cap says so out loud
 *
 * Ordered by ETA, because the shipment arriving on Tuesday is the one whose
 * discharge date is about to become a demurrage clock. When the fleet exceeds
 * the configured batch, the result names how many were left — a silent
 * truncation would read as "we polled everything" for as long as nobody
 * counted.
 */

import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import {
  authSession,
  jobMilestones,
  jobPartners,
  jobs,
  partners,
  systemActor,
  withActor,
} from '@qabandi/db'
import { carrierTracking } from '../adapters/index'
import { integration } from '../settings'
import type { DcsaPollResult, DcsaTracking } from '../adapters/dcsa-tracking'
import { DcsaError } from '../adapters/dcsa-tracking'
import { writeCarrierMilestone } from './carrier-milestone'

export interface CarrierPollResult {
  readonly source: string
  /** Shipments asked about. */
  readonly polled: number
  readonly written: number
  /** Milestones a person had already entered, left alone. */
  readonly preserved: number
  /** ETAs the carrier revised. */
  readonly revised: number
  /** Shipments whose carrier refused or errored, with the reason. */
  readonly failed: { reference: string; reason: string }[]
  /**
   * Jobs whose carrier has never heard of the reference we asked with.
   *
   * Kept apart from `failed` because nothing is broken — a booking was
   * cancelled, or a master bill has a digit wrong — and apart from silence
   * because it is the one outcome an operator can actually fix.
   */
  readonly unrecognised: string[]
  /**
   * Jobs whose reference cannot match the carrier's rules, and why.
   *
   * The one outcome on this list that is fixed by editing a job rather than by
   * waiting: a bill of lading with a digit missing, or a booking number typed
   * into the wrong field. Reported separately because it is also the one that
   * costs nothing to detect and would otherwise repeat every hour.
   */
  readonly malformed: string[]
  /** Carrier codes this build does not understand, deduplicated. */
  readonly unmapped: string[]
  /** Shipments the batch cap left for the next run. */
  readonly deferred: number
  /** Gateways that told us to slow down, and were left alone afterwards. */
  readonly rateLimited: string[]
  /** Set when the run did not ask anybody anything, and why. */
  readonly skipped?: string
}

/** A tracking adapter that can answer a carrier-direct poll. */
function asDcsa(source: { key: string }): DcsaTracking | undefined {
  return 'scacs' in source && 'read' in source ? (source as DcsaTracking) : undefined
}

/**
 * Has anybody been signed in recently enough to be worth spending quota on?
 *
 * `auth_session.updated_at` rather than `expires_at`, and the difference
 * matters: a session lasts twelve hours and is refreshed hourly while it is
 * being used (`apps/web/src/lib/auth.ts`), so `expires_at` stays in the future
 * for half a day after somebody closed the laptop. `updated_at` moves only
 * when the session is actually used.
 *
 * The window therefore wants to be at least the session refresh age — an hour
 * — or a person working steadily through the afternoon looks idle between
 * refreshes and the feed switches itself off underneath them.
 */
async function someoneIsAround(withinMinutes: number): Promise<boolean> {
  const since = new Date(Date.now() - withinMinutes * 60_000)

  return withActor(systemActor(), async (tx) => {
    const [seen] = await tx
      .select({ id: authSession.id })
      .from(authSession)
      .where(and(gt(authSession.updatedAt, since), gt(authSession.expiresAt, new Date())))
      .limit(1)

    return Boolean(seen)
  })
}

export async function runCarrierPoll(): Promise<CarrierPollResult> {
  const empty = {
    polled: 0,
    written: 0,
    preserved: 0,
    revised: 0,
    failed: [],
    unrecognised: [],
    malformed: [],
    unmapped: [],
    rateLimited: [],
  }
  /*
    The poll's budget, read from its settings row.

    `batch × runs-per-hour ≤ the carrier's cap` is the arithmetic a deployment
    has to get right, and it changes when a carrier tier changes — a commercial
    event, on the client's calendar rather than ours. It was three environment
    variables and a worked example in a comment; it is a form that checks the
    multiplication now.
  */
  const poll = await integration('carrierPoll')
  const batchSize = poll.number('batch', 15)
  const activeWithin = poll.number('activeWithinMinutes', 0)

  const source = await carrierTracking()
  const dcsa = asDcsa(source)

  /*
    A deployment on `manual` answers "nothing to do" rather than branching.

    It has no feed, so the poll has nothing to ask. Keeping the worker's shape
    identical in both configurations means the schedule is the same everywhere
    and nobody has to know which mode a deployment is in to read its log.
  */
  if (!dcsa) return { source: source.key, ...empty, deferred: 0 }

  const scacs = dcsa.scacs

  if (scacs.length === 0) return { source: source.key, ...empty, deferred: 0 }

  /*
    Spend the carrier's budget on hours somebody is looking.

    A trial tier allows twenty calls an hour, and a poll that runs all night
    against an empty office arrives at nine with the quota already gone. Off by
    default — see the poll settings at Settings › Integrations, which explain why
    production wants the opposite.
  */
  if (activeWithin > 0) {
    if (!(await someoneIsAround(activeWithin))) {
      return {
        source: source.key,
        ...empty,
        deferred: 0,
        skipped: `nobody signed in within ${activeWithin}m`,
      }
    }
  }

  const candidates = await withActor(systemActor(), (tx) =>
    tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        mode: jobs.mode,
        // Half of the milestone template lookup — see `MilestoneTarget`.
        tradeDirection: jobs.tradeDirection,
        eta: jobs.eta,
        scac: partners.scac,
        bookingNumber: jobs.bookingNumber,
        masterBillNumber: jobs.masterBillNumber,
      })
      .from(jobs)
      .innerJoin(jobPartners, and(eq(jobPartners.jobId, jobs.id), eq(jobPartners.role, 'carrier')))
      .innerJoin(partners, eq(partners.id, jobPartners.partnerId))
      .where(
        and(
          isNull(jobs.closedAt),
          isNull(jobs.cancelledAt),
          ne(jobs.status, 'draft'),
          or(eq(jobs.mode, 'sea_fcl'), eq(jobs.mode, 'sea_lcl')),
          isNotNull(partners.scac),
          eq(partners.isActive, true),
          or(isNotNull(jobs.bookingNumber), isNotNull(jobs.masterBillNumber)),
          /*
            The SCAC filter is in SQL rather than in a `.filter()` afterwards
            so the batch cap counts shipments we can actually ask about. Doing
            it in memory would let a fleet of unregistered carriers fill the
            cap and starve the ones we can.
          */
          inArray(sql`upper(${partners.scac})`, scacs),
        ),
      )
      .orderBy(sql`${jobs.eta} asc nulls last`, asc(jobs.reference))
      .limit(batchSize + 1),
  )

  const deferred = Math.max(0, candidates.length - batchSize)
  const batch = candidates.slice(0, batchSize)

  let written = 0
  let preserved = 0
  let revised = 0
  const failed: { reference: string; reason: string }[] = []
  const unrecognised: string[] = []
  const malformed: string[] = []
  const unmapped = new Set<string>()
  /*
    Gateways that have told us to slow down, for the rest of this run.

    Keyed on the gateway rather than the SCAC, because the budget is charged
    there: Maersk answers for Sealand too, and backing off on `MAEU` while
    carrying on with `SEAU` is not backing off at all.
  */
  const rateLimited = new Set<string>()

  for (const job of batch) {
    /*
      Asked before calling, so a 429 costs one request and not the rest of
      the fleet.

      Being told to slow down and then sending another hundred is how a trial
      key gets withdrawn — and every one of those calls is a failure line in a
      log that somebody has to read past to find the real problem.
    */
    const gateway = dcsa.carrierFor(job.scac!)
    if (gateway && rateLimited.has(gateway)) continue

    /*
      The booking number first.

      It is the carrier's own reference for the booking and the one they
      resolve fastest; the master bill exists only once the document is issued,
      which on a fresh export is days after the box is picked up. Asking with
      whichever we have means the feed starts at the first milestone rather
      than the fifth.
    */
    const query = job.bookingNumber
      ? { reference: job.bookingNumber, type: 'booking_number' as const, scac: job.scac! }
      : { reference: job.masterBillNumber!, type: 'bill_of_lading' as const, scac: job.scac! }

    let reading: DcsaPollResult
    try {
      reading = await dcsa.read(query)
    } catch (error) {
      /*
        A credential failure stops the run rather than walking the fleet.

        `DcsaError.retryable` is false only for 401 and 403, which mean this
        deployment's key is wrong. Continuing would spend the rest of the batch
        proving the same thing to the same carrier, and — because carriers
        rate-limit failures too — could cost the run for the carriers that
        *are* working.
      */
      if (error instanceof DcsaError && !error.retryable) throw error

      /*
        429 stops this gateway for the run rather than being retried per
        shipment. The next scheduled run is the retry, and it starts with a
        fresh hour's budget — which is exactly the backoff the carrier asked
        for, and cheaper than pg-boss retrying a whole batch to rediscover the
        same limit.
      */
      if (error instanceof DcsaError && error.status === 429) {
        rateLimited.add(error.carrier)
      }

      failed.push({
        reference: job.reference,
        reason: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    if (reading.malformedReference) {
      malformed.push(`${job.reference}: ${reading.malformedReference}`)
      continue
    }

    if (reading.unknownReference) {
      unrecognised.push(`${job.reference} (${job.scac} does not know ${query.reference})`)
      continue
    }

    for (const code of reading.unmapped) unmapped.add(code)

    await withActor(systemActor(), async (tx) => {
      for (const milestone of reading.milestones) {
        const result = await writeCarrierMilestone(tx, job, milestone, `Carrier feed · ${job.scac}`)
        if (result.status === 'written') written += 1
        if (result.status === 'preserved') preserved += 1
      }

      /*
        The ETA revision, which is the other thing a coordinator refreshes a
        carrier website for.

        Guarded on the vessel not having arrived: a carrier's event list keeps
        returning the estimates it published before the fact, and applying one
        after the ship has docked would move a landed shipment's ETA back into
        the future. `vessel_arrived` is the milestone that says it is over.
      */
      if (!reading.estimates.eta && !reading.estimates.etd) return

      const [arrived] = await tx
        .select({ id: jobMilestones.id })
        .from(jobMilestones)
        .where(
          and(
            eq(jobMilestones.jobId, job.id),
            eq(jobMilestones.code, 'vessel_arrived'),
            isNotNull(jobMilestones.actualAt),
          ),
        )
        .limit(1)

      if (arrived) return

      const changes: { eta?: Date; etd?: Date } = {}
      if (reading.estimates.eta) changes.eta = reading.estimates.eta
      if (reading.estimates.etd) changes.etd = reading.estimates.etd

      /*
        Written only when it actually moved.

        `jobs` is audited, and an hourly worker that re-wrote the same ETA
        would put twenty-four identical rows a day into the log somebody reads
        during a dispute. An audit trail nobody can skim is one nobody uses.
      */
      const [current] = await tx
        .select({ eta: jobs.eta, etd: jobs.etd })
        .from(jobs)
        .where(eq(jobs.id, job.id))
        .limit(1)

      const moved =
        (changes.eta && current?.eta?.getTime() !== changes.eta.getTime()) ||
        (changes.etd && current?.etd?.getTime() !== changes.etd.getTime())

      if (!moved) return

      await tx.update(jobs).set(changes).where(eq(jobs.id, job.id))
      revised += 1
    })
  }

  return {
    source: source.key,
    polled: batch.length,
    written,
    preserved,
    revised,
    failed,
    unrecognised,
    malformed,
    unmapped: [...unmapped],
    deferred,
    rateLimited: [...rateLimited],
  }
}
