/**
 * Sending rate requests to agents — the near end of rate procurement, FR-RT-10.
 *
 * A coordinator picks agents on the enquiry screen and the web action writes one
 * `rate_requests` row per agent, `status = 'sent'`, `sent_at` still null, each
 * with its own opaque `token`. This worker turns those rows into email: it reads
 * the lane and cargo off the enquiry, addresses the agent's primary contact, and
 * sends an RFQ whose subject carries the token so the reply routes itself back
 * (`rfq-routing.ts`). On a send it stamps `sent_at`; the row already reads as
 * `sent`, which is "asked, awaiting reply".
 *
 * ## Why a job and not the request handler
 *
 * The same reason the extraction jobs are jobs: a coordinator who asked five
 * agents should not hold a request open while five relays are dialled, and one
 * agent whose mail bounces must not fail the other four. Each send is
 * independent; a request with no contact on file is skipped and left `sent` for
 * a person to chase, never thrown.
 *
 * ## No loop to break here, but the reply side has one
 *
 * This mails agents, not the senders of inbound mail, so it is not the path that
 * once turned a bounce into 195 enquiries (`Operations_Findings §11`). The reply
 * these RFQs draw is caught by the token in `ingestMessage`, which routes it to
 * extraction and never opens an enquiry or answers the agent — so the loop that
 * rule guards against cannot start here either.
 */

import { and, eq, isNull } from 'drizzle-orm'
import {
  enquiries,
  locations,
  partnerContacts,
  rateCards,
  rateRequests,
  systemActor,
  withActor,
  type Tx,
} from '@qabandi/db'
import type { NotificationChannel } from '../ports/index'
import { resolveEmailChannel } from '../adapters/index'
import { rfqSubjectTag } from './rfq-routing'

/**
 * How many pending requests one sweep sends.
 *
 * A guard against a bad import that created five thousand requests at once
 * dialling the relay five thousand times in one tick. The remainder waits for
 * the next minute — a coordinator's hand-picked fan-out of five agents is never
 * near this, and a genuine backlog drains steadily rather than in a spike.
 */
const SEND_BATCH = 200

export interface SendRateRequestsResult {
  readonly sent: number
  /** Requests with no agent contact on file — left for a person to chase. */
  readonly skipped: number
  /** Requests the relay refused — retried on the next sweep. */
  readonly failed: number
}

export interface SendRateRequestsDeps {
  /** Injected in tests; resolved from the deployment's SMTP settings otherwise. */
  readonly channel?: NotificationChannel
}

/**
 * Send every rate request that is waiting to go out.
 *
 * A drain, not an addressed job: the web action writes `rate_requests` rows and
 * this sweep — scheduled every minute, like the mail poll — turns the ones still
 * `sent` with no `sent_at` into email. Web has no queue access, so a drain is
 * the seam that needs none, and stamping `sent_at` on a success is what stops
 * the next sweep re-sending. A minute's latency to an agent's inbox is nothing.
 */
export async function sendRateRequests(deps: SendRateRequestsDeps = {}): Promise<SendRateRequestsResult> {
  const actor = systemActor()
  const rows = await loadPending(actor)
  if (rows.length === 0) return { sent: 0, skipped: 0, failed: 0 }

  const channel = deps.channel ?? (await resolveEmailChannel(() => {}))

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    if (!row.contactEmail) {
      skipped += 1
      continue
    }

    const result = await channel.send({
      to: row.contactEmail,
      subject: rfqSubject(row),
      body: rfqBody(row),
      locale: 'en',
    })

    if (!result.accepted) {
      failed += 1
      continue
    }

    await withActor(actor, async (tx: Tx) => {
      await tx.update(rateRequests).set({ sentAt: new Date() }).where(eq(rateRequests.id, row.id))
    })
    sent += 1
  }

  return { sent, skipped, failed }
}

interface SendRow {
  readonly id: string
  readonly token: string
  readonly mode: string | null
  readonly originCode: string | null
  readonly originName: string | null
  readonly destinationCode: string | null
  readonly destinationName: string | null
  readonly readyOn: string | null
  readonly grossWeightKg: string | null
  readonly volumeCbm: string | null
  readonly pieces: number | null
  readonly incoterm: string | null
  readonly reference: string | null
  readonly contactEmail: string | null
  readonly contactName: string | null
}

/**
 * The requests waiting to go out, with their lane, cargo and the agent to write to.
 *
 * Read under the system actor across every branch — the sweep is deployment-
 * wide, like the mail poll. The primary contact wins over the rest (a partner's
 * desk address rather than whoever was added last), and a contact with no email
 * is treated as no contact, because an RFQ with nowhere to go is a skip a person
 * chases, not a send that quietly does nothing.
 */
async function loadPending(actor: ReturnType<typeof systemActor>): Promise<SendRow[]> {
  return withActor(actor, async (tx: Tx) => {
    const requests = await tx
      .select({
        id: rateRequests.id,
        token: rateRequests.token,
        partnerId: rateRequests.partnerId,
        enquiryId: rateRequests.enquiryId,
        sourceRateCardId: rateRequests.sourceRateCardId,
      })
      .from(rateRequests)
      .where(and(eq(rateRequests.status, 'sent'), isNull(rateRequests.sentAt)))
      .limit(SEND_BATCH)

    const out: SendRow[] = []
    for (const req of requests) {
      // The lane and cargo come from the enquiry, or — for a renewal RFQ — from
      // the expiring card, which carries the lane but no cargo (a rate card is
      // per-lane, so a renewal email asks for the lane and needs no shipment).
      const enquiry = req.enquiryId
        ? await enquiryFor(tx, req.enquiryId)
        : req.sourceRateCardId
          ? await cardLaneFor(tx, req.sourceRateCardId)
          : null
      const contact = await primaryContact(tx, req.partnerId)
      out.push({
        id: req.id,
        token: req.token,
        mode: enquiry?.mode ?? null,
        originCode: enquiry?.originCode ?? null,
        originName: enquiry?.originName ?? null,
        destinationCode: enquiry?.destinationCode ?? null,
        destinationName: enquiry?.destinationName ?? null,
        readyOn: enquiry?.readyOn ?? null,
        grossWeightKg: enquiry?.grossWeightKg ?? null,
        volumeCbm: enquiry?.volumeCbm ?? null,
        pieces: enquiry?.pieces ?? null,
        incoterm: enquiry?.incoterm ?? null,
        reference: enquiry?.reference ?? null,
        contactEmail: contact?.email ?? null,
        contactName: contact?.name ?? null,
      })
    }
    return out
  })
}

async function enquiryFor(tx: Tx, enquiryId: string) {
  const rows = await tx
    .select({
      mode: enquiries.mode,
      originId: enquiries.originId,
      destinationId: enquiries.destinationId,
      readyOn: enquiries.readyOn,
      grossWeightKg: enquiries.grossWeightKg,
      volumeCbm: enquiries.volumeCbm,
      pieces: enquiries.pieces,
      incoterm: enquiries.incoterm,
      reference: enquiries.reference,
    })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)
  const e = rows[0]
  if (!e) return null

  const origin = e.originId ? await place(tx, e.originId) : null
  const destination = e.destinationId ? await place(tx, e.destinationId) : null

  return {
    mode: e.mode,
    originCode: origin?.code ?? null,
    originName: origin?.name ?? null,
    destinationCode: destination?.code ?? null,
    destinationName: destination?.name ?? null,
    readyOn: e.readyOn,
    grossWeightKg: e.grossWeightKg,
    volumeCbm: e.volumeCbm,
    pieces: e.pieces,
    incoterm: e.incoterm,
    reference: e.reference,
  }
}

/** The lane of the card a renewal RFQ renews — no cargo, a rate card has none. */
async function cardLaneFor(tx: Tx, rateCardId: string) {
  const rows = await tx
    .select({
      mode: rateCards.mode,
      originId: rateCards.originId,
      destinationId: rateCards.destinationId,
    })
    .from(rateCards)
    .where(eq(rateCards.id, rateCardId))
    .limit(1)
  const c = rows[0]
  if (!c) return null

  const origin = c.originId ? await place(tx, c.originId) : null
  const destination = c.destinationId ? await place(tx, c.destinationId) : null

  return {
    mode: c.mode,
    originCode: origin?.code ?? null,
    originName: origin?.name ?? null,
    destinationCode: destination?.code ?? null,
    destinationName: destination?.name ?? null,
    readyOn: null,
    grossWeightKg: null,
    volumeCbm: null,
    pieces: null,
    incoterm: null,
    reference: null,
  }
}

async function place(tx: Tx, locationId: string) {
  const rows = await tx
    .select({ code: locations.unlocode, name: locations.nameEn })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1)
  return rows[0] ?? null
}

async function primaryContact(tx: Tx, partnerId: string) {
  const rows = await tx
    .select({
      email: partnerContacts.email,
      name: partnerContacts.nameEn,
      isPrimary: partnerContacts.isPrimary,
    })
    .from(partnerContacts)
    .where(and(eq(partnerContacts.partnerId, partnerId), eq(partnerContacts.isActive, true)))

  const withEmail = rows.filter((r) => r.email)
  if (withEmail.length === 0) return null
  return withEmail.find((r) => r.isPrimary) ?? withEmail[0]
}

const MODE_LABEL: Record<string, string> = {
  sea_fcl: 'Sea FCL',
  sea_lcl: 'Sea LCL',
  air: 'Air',
  land: 'Land',
  courier: 'Courier',
}

function laneText(row: SendRow): string {
  const from = row.originName ? `${row.originName} (${row.originCode ?? '?'})` : (row.originCode ?? '?')
  const to = row.destinationName
    ? `${row.destinationName} (${row.destinationCode ?? '?'})`
    : (row.destinationCode ?? '?')
  return `${from} → ${to}`
}

function rfqSubject(row: SendRow): string {
  const mode = row.mode ? MODE_LABEL[row.mode] ?? row.mode : 'freight'
  return `Rate request ${rfqSubjectTag(row.token)} — ${laneText(row)} (${mode})`
}

/**
 * The RFQ body.
 *
 * Inline copy for now, English, because agents are international and the lane is
 * codes and dates a broker reads in any language. This is a candidate to become
 * a bilingual `notification_templates` row an administrator edits (FR-AD-03) —
 * the comment is the marker. The one line that must not change casually is the
 * "reply keeping the subject" instruction: the token in the subject is how the
 * reply finds its way home.
 */
function rfqBody(row: SendRow): string {
  const lines: string[] = []
  lines.push(row.contactName ? `Dear ${row.contactName},` : 'Dear partner,')
  lines.push('')
  lines.push('Please quote your best rate for the shipment below.')
  lines.push('')
  lines.push(`  Lane:      ${laneText(row)}`)
  if (row.mode) lines.push(`  Mode:      ${MODE_LABEL[row.mode] ?? row.mode}`)
  if (row.readyOn) lines.push(`  Ready on:  ${row.readyOn}`)
  if (row.incoterm) lines.push(`  Incoterm:  ${row.incoterm}`)
  if (row.pieces != null) lines.push(`  Pieces:    ${row.pieces}`)
  if (row.grossWeightKg) lines.push(`  Weight:    ${row.grossWeightKg} kg`)
  if (row.volumeCbm) lines.push(`  Volume:    ${row.volumeCbm} cbm`)
  lines.push('')
  lines.push('Kindly reply to this email, keeping the subject line, with your charges,')
  lines.push('currency, and how long the rate is valid. Please break the charges out')
  lines.push('by type (freight, THC, documentation, and so on).')
  lines.push('')
  lines.push('Thank you.')
  return lines.join('\n')
}
