/**
 * Automatic rate procurement — FR-RT-10, the hands-off half of the RFQ fan-out.
 *
 * The manual path is a coordinator picking agents on the enquiry screen. This is
 * the same fan-out with nobody clicking: an enquiry that has reached a resolvable
 * lane has an RFQ opened to every covering agent, once, and the existing
 * `rate-request-send` sweep mails them the next minute. It writes exactly the
 * rows that action writes — `status = 'sent'`, one opaque token each — so the
 * send, the reply routing and the comparison downstream cannot tell the two
 * apart.
 *
 * ## It ships dark, and the gate is a real setting
 *
 * This mails real agents, and the dev mailbox is a real inbox, so it does
 * nothing until an administrator switches the `rateAutoFanout` integration to
 * `auto`. On the inert `manual` default the sweep still runs every minute and
 * answers "nothing to do" immediately — the house idiom `carrierPoll` and
 * `fxIngest` follow, a feature that switches on with a row rather than a deploy.
 *
 * ## Why a complete lane is the whole eligibility gate
 *
 * `mode`, `origin_id` and `destination_id` are null on an enquiry until a person
 * (or a future auto-accept step) confirms them — extraction writes *proposals*,
 * never the columns. So "the lane is complete" already means "the lane was
 * confirmed", which is what makes it safe to ask agents without a human in the
 * loop here: we never RFQ a lane a model guessed and nobody checked.
 *
 * ## …and a recent one
 *
 * A complete lane is necessary but not sufficient: the enquiry must also be
 * younger than the integration's `maxAgeHours` (48 by default). Switching the
 * sweep on is a decision about enquiries from now on, not a licence to mail
 * agents about a backlog nobody has looked at in weeks (F61).
 *
 * ## The loop-breaker
 *
 * An enquiry with any non-superseded `rate_requests` is not eligible, so the
 * fan-out fires once and the next sweep passes it by. It is the same guard the
 * manual action uses to avoid asking an agent twice — here it also stops the
 * sweep re-opening RFQs every minute.
 */

import { randomBytes } from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'
import {
  intakeNotReady,
  enquiries,
  locations,
  partnerContacts,
  partnerCoverage,
  partners,
  rateRequests,
  systemActor,
  withActor,
  type Tx,
} from '@qabandi/db'
import { integration, type LiveIntegration } from '../settings'

/** How many enquiries one sweep fans out — a bad backlog drains steadily. */
const ENQUIRY_BATCH = 50
/** The default cap on agents per lane, when the setting supplies none. */
const DEFAULT_MAX_AGENTS = 6
/**
 * How old an enquiry may be and still be fanned out, when the setting supplies
 * no other figure — see `maxAgeHours` on the integration (F61).
 */
const DEFAULT_MAX_AGE_HOURS = 48
/** The pre-quote states an open enquiry can be fanned out from. */
const OPEN_STATUSES = ['new', 'assigned', 'rating'] as const

export interface AutoFanoutResult {
  /** False when the integration is on its inert default — nothing was looked at. */
  readonly enabled: boolean
  /** Enquiries that had at least one RFQ opened. */
  readonly enquiries: number
  /** Rate requests opened across all of them. */
  readonly requests: number
  /** Eligible enquiries with no emailable covering agent — left for a person. */
  readonly skipped: number
  /** Enquiries whose fan-out threw — logged with the reason, retried next sweep. */
  readonly failed: number
}

const EMPTY: AutoFanoutResult = {
  enabled: false,
  enquiries: 0,
  requests: 0,
  skipped: 0,
  failed: 0,
}

export interface AutoFanoutDeps {
  /**
   * The resolved gate. Injected in tests; resolved from the deployment's
   * integration settings otherwise — the settings snapshot is cached for thirty
   * seconds and deliberately un-clearable, so a test that switched the driver
   * through the environment could not switch it back within one run.
   */
  readonly source?: LiveIntegration
}

/** A token that survives a mail round-trip — hex, matched by `rfq-routing.ts`. */
function newToken(): string {
  return randomBytes(12).toString('hex')
}

/**
 * Fan an RFQ out to the covering agents of every enquiry ready for one.
 *
 * Returns counts and never throws on a business skip: an enquiry with no
 * emailable agent is counted and left, so one lane nobody covers does not stop
 * the sweep, and a returned result — rather than a thrown one — does not burn a
 * pg-boss retry on "there was nothing to do".
 */
export async function autoFanoutRateRequests(deps: AutoFanoutDeps = {}): Promise<AutoFanoutResult> {
  /*
    The gate is the driver value, not `.live` — an env-resolved integration
    reports `live: true` whatever driver it names (settings.ts `envOnly`), so
    only comparing the driver to the live value tells "off" from "on" on both the
    row and the env path. `carrier-poll` gates the same way, on `asDcsa`.
  */
  const source = deps.source ?? (await integration('rateAutoFanout'))
  if (source.driver !== 'auto') return EMPTY

  const maxAgents = clamp(source.number('maxAgents', DEFAULT_MAX_AGENTS), 1, 20)
  const maxAgeHours = Math.round(clamp(source.number('maxAgeHours', DEFAULT_MAX_AGE_HOURS), 1, 720))
  const actor = systemActor()

  const eligible = await withActor(actor, (tx: Tx) =>
    tx
      .select({
        id: enquiries.id,
        branchId: enquiries.branchId,
        mode: enquiries.mode,
        originId: enquiries.originId,
        destinationId: enquiries.destinationId,
      })
      .from(enquiries)
      .where(
        and(
          inArray(enquiries.status, [...OPEN_STATUSES]),
          isNotNull(enquiries.mode),
          isNotNull(enquiries.originId),
          isNotNull(enquiries.destinationId),
          /*
            Only enquiries recent enough to be the reason the switch was
            thrown (F61). Without this, turning `auto` on RFQ'd every open
            enquiry with a complete lane however old — four idle ones went
            to agents within a minute on the dev instance. An older enquiry
            is not refused anything: a person can still ask from its screen,
            knowing whether the customer is still waiting. Measured in the
            database's clock, like `created_at` itself.
          */
          sql`${enquiries.createdAt} >= now() - make_interval(hours => ${maxAgeHours}::int)`,
          /*
            Not while the intake agent is still collecting it. An inbound
            enquiry with a lane but no container type is one the agent is about
            to ask the customer about, and emailing six agents a half-request
            costs their goodwill and returns six rates for the wrong box. The
            agent raises the flag the turn the enquiry is complete; an enquiry
            it does not hold is never held back.
          */
          sql`not ${intakeNotReady(enquiries.id)}`,
          // The loop-breaker: nothing already asked on this enquiry.
          sql`not exists (
            select 1 from ${rateRequests} r
             where r.enquiry_id = ${enquiries.id} and r.status <> 'superseded'
          )`,
          /*
            Only lanes somebody covers — the same match as `coveringAgentIds`
            (port, or country, per mode; an active contact with an email).

            Without this the batch filled with enquiries no agent covers. They
            are never asked, so they stay eligible forever, and with no order
            the same fifty came back every sweep: past fifty uncovered
            enquiries, a covered lane was never fanned out at all. The
            per-enquiry check below still decides who is asked.
          */
          sql`exists (
            select 1
              from ${partnerCoverage} c
              join ${partners} p on p.id = c.partner_id and p.is_active
              join ${partnerContacts} pc
                on pc.partner_id = c.partner_id and pc.is_active and pc.email is not null
              join ${locations} o on o.id = ${enquiries.originId}
              join ${locations} d on d.id = ${enquiries.destinationId}
             where c.is_active
               and c.mode = ${enquiries.mode}
               and (c.origin_id = o.id or c.origin_country = o.country_code)
               and (c.destination_id = d.id or c.destination_country = d.country_code)
          )`,
        ),
      )
      // Oldest first: a stable, fair order rather than whatever the planner returns.
      .orderBy(asc(enquiries.createdAt))
      .limit(ENQUIRY_BATCH),
  )

  let fanned = 0
  let requests = 0
  let skipped = 0
  let failed = 0

  for (const enquiry of eligible) {
    // Per enquiry, so one lane's failure is not the sweep's. The read of covering
    // agents and the insert share the transaction, so an agent that gains a rate
    // request between the two cannot be asked twice by two overlapping sweeps.
    try {
      const opened = await withActor(actor, async (tx: Tx) => {
        const partnerIds = await coveringAgentIds(tx, enquiry, maxAgents)
        if (partnerIds.length === 0) return 0

        await tx.insert(rateRequests).values(
          partnerIds.map((partnerId) => ({
            branchId: enquiry.branchId,
            enquiryId: enquiry.id,
            partnerId,
            status: 'sent' as const,
            token: newToken(),
          })),
        )
        return partnerIds.length
      })

      if (opened === 0) skipped += 1
      else {
        fanned += 1
        requests += opened
      }
    } catch (error) {
      /*
        A single lane's failure is left for the next sweep; the rest fan out.

        Counted apart from `skipped` and logged with its reason. Folded into
        `skipped`, a database or pricing fault read exactly like "nobody covers
        this lane" — the one answer that tells nobody to look.
      */
      failed += 1
      console.error(
        { enquiryId: enquiry.id, error: error instanceof Error ? error.message : String(error) },
        'rate auto-fanout: enquiry failed, left for the next sweep',
      )
    }
  }

  return { enabled: true, enquiries: fanned, requests, skipped, failed }
}

/**
 * The covering agents for one enquiry that can be asked now — ported from the
 * web's `listCoveringAgents`, filtered here to the ones worth writing a row for.
 *
 * Coverage is matched at the port where an agent declared a port and at the
 * country where they declared a country. An agent is kept only if it has an
 * active contact with an email and is not already on this enquiry, and the set
 * is capped so a lane forty agents cover does not become forty emails.
 */
async function coveringAgentIds(
  tx: Tx,
  enquiry: {
    id: string
    mode: string | null
    originId: string | null
    destinationId: string | null
  },
  maxAgents: number,
): Promise<string[]> {
  if (!enquiry.mode || !enquiry.originId || !enquiry.destinationId) return []

  const originCountry = await countryOf(tx, enquiry.originId)
  const destinationCountry = await countryOf(tx, enquiry.destinationId)

  const covering = await tx
    .selectDistinct({ partnerId: partnerCoverage.partnerId })
    .from(partnerCoverage)
    .innerJoin(partners, eq(partnerCoverage.partnerId, partners.id))
    .where(
      and(
        eq(partnerCoverage.mode, enquiry.mode as 'sea_fcl'),
        eq(partnerCoverage.isActive, true),
        /*
          A deactivated partner is one we stopped working with. Their coverage
          rows are not retired with them — nothing is deleted, and an
          administrator switches off the partner, not each lane — so the
          partner's own flag is the one that has to be read here, or the sweep
          keeps mailing RFQs to an agent somebody deliberately let go.
        */
        eq(partners.isActive, true),
        or(
          eq(partnerCoverage.originId, enquiry.originId),
          originCountry ? eq(partnerCoverage.originCountry, originCountry) : sql`false`,
        ),
        or(
          eq(partnerCoverage.destinationId, enquiry.destinationId),
          destinationCountry
            ? eq(partnerCoverage.destinationCountry, destinationCountry)
            : sql`false`,
        ),
      ),
    )

  const partnerIds = covering.map((row) => row.partnerId)
  if (partnerIds.length === 0) return []

  const withEmail = new Set(
    (
      await tx
        .selectDistinct({ partnerId: partnerContacts.partnerId })
        .from(partnerContacts)
        .where(
          and(
            inArray(partnerContacts.partnerId, partnerIds),
            eq(partnerContacts.isActive, true),
            sql`${partnerContacts.email} is not null`,
          ),
        )
    ).map((row) => row.partnerId),
  )

  const already = new Set(
    (
      await tx
        .selectDistinct({ partnerId: rateRequests.partnerId })
        .from(rateRequests)
        .where(and(eq(rateRequests.enquiryId, enquiry.id), ne(rateRequests.status, 'superseded')))
    ).map((row) => row.partnerId),
  )

  return partnerIds.filter((id) => withEmail.has(id) && !already.has(id)).slice(0, maxAgents)
}

/** The country a location sits in, for country-level coverage matching. */
async function countryOf(tx: Tx, locationId: string): Promise<string | null> {
  const [row] = await tx
    .select({ country: locations.countryCode })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1)
  return row?.country ?? null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
