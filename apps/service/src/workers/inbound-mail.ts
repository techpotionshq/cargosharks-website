/**
 * Inbound mail onto the board — FR-EQ-02, FR-NT-05.
 *
 * The requirement is one sentence — *"a per-branch forwarding address that
 * turns an inbound email into an enquiry with body and attachments
 * preserved"* — and the SRS's own diagnosis of why it matters is blunter:
 * Al-Qabandi's front door is five mailboxes, and a shipment quoted out of one
 * of them has no shared record with the office that will handle it.
 *
 * This is the door. A message arrives, and it becomes one of two things:
 *
 *   a reply on something we already know about  -> a message on that thread
 *   anything else                               -> a new enquiry, with a clock
 *
 * ## Attribution refuses ambiguity, as it does for carrier events
 *
 * `carrier-event.ts` argues that a match finding more than one job is no match
 * at all, because a misattributed event writes false history onto a real
 * shipment. The same rule holds here for the same reason, and the stakes are
 * if anything higher: threading a customer's mail onto the wrong job puts one
 * customer's correspondence in front of another through the portal.
 *
 * So the sender is matched to a customer on an exact contact address, and only
 * then on a domain that belongs to exactly one customer. Two candidates means
 * none, and the enquiry is created with `contact_email` set and `customer_id`
 * null — which is precisely what that column pair was put on `enquiries` for.
 *
 * ## Why the receipt is claimed before the work, not after
 *
 * `inbound_webhook_events` is unique on `(provider, external_id)`, and the
 * insert is the claim. Processing then happens, and `processed_at` is stamped
 * at the end. A crash in between leaves a claimed-but-unprocessed row, and the
 * next run finds it and retries it rather than treating it as done — which is
 * the difference between at-least-once and at-most-once, and this queue must
 * be the former. An enquiry that never arrived is a customer who went
 * elsewhere; a duplicate is a coordinator closing one of two rows.
 *
 * ## Nothing here trusts the sender
 *
 * Every field on an inbound message is attacker-controlled: the display name,
 * the subject, the filename of every attachment. Names are stored as data and
 * never interpolated anywhere, bodies are flattened to text by the adapter
 * before they arrive here, and attachment filenames are sanitised on the way
 * into a storage key rather than on the way out.
 */

import { and, eq, sql } from 'drizzle-orm'
import {
  assets,
  branches,
  calendarHolidays,
  customerContacts,
  enquiries,
  inboundWebhookEvents,
  jobs,
  messageAttachments,
  messages,
  notificationOutbox,
  systemActor,
  withActor,
  workingCalendars,
} from '@qabandi/db'
import { slaDueAt, type WorkingCalendar } from '@qabandi/core'
import { adapters, resolveInboundMail } from '../adapters/index'
import { config } from '../config'
import type { InboundMailSource, InboundMessage } from '../ports/index'
import { identifyingDomain, inboundStorageKey, referencesIn } from './inbound-routing'

/** Enquiry SLA: four working hours to a first response — FR-EQ-01. */
const FIRST_RESPONSE_MINUTES = 4 * 60

/** The provider name on the receipt row. */
const PROVIDER = 'imap'

export interface InboundMailResult {
  readonly collected: number
  readonly created: number
  readonly threaded: number
  readonly duplicates: number
  readonly failed: number
}

/**
 * One pass over every configured mailbox.
 *
 * Mailboxes are polled in sequence rather than together. Five IMAP
 * conversations at once buys nothing at this volume, and a serial loop means
 * one unreachable host delays the others by its timeout instead of racing them
 * for the same worker's attention.
 *
 * `sources` defaults to what the configuration resolves to and is a parameter
 * so a test can hand over messages without an IMAP server — which is the seam
 * `InboundMailSource` exists to provide, and the only way the rules below get
 * exercised against a real database rather than a mock of one.
 */
export async function runInboundMailPoll(
  asOf = new Date(),
  sources: readonly InboundMailSource[] = resolveInboundMail(),
): Promise<InboundMailResult> {
  if (sources.length === 0) {
    return { collected: 0, created: 0, threaded: 0, duplicates: 0, failed: 0 }
  }

  const branchByMailbox = await resolveBranches()

  let collected = 0
  let created = 0
  let threaded = 0
  let duplicates = 0
  let failed = 0

  for (const source of sources) {
    try {
      await source.collect(async (message) => {
        collected++
        const branch = branchByMailbox.get(message.mailbox)

        /*
          A mailbox whose branch code matches nothing is a configuration error,
          and it throws rather than filing the mail somewhere plausible.
          Throwing leaves the message unflagged, so nothing is lost while
          somebody fixes the code — and `branch_id` is not nullable on either
          `enquiries` or `messages`, so there is no somewhere-plausible to file
          it to in any case.
        */
        if (!branch) {
          throw new Error(
            `Mailbox ${message.mailbox} names branch code ` +
              `"${mailboxBranchCode(message.mailbox)}", which no branch has. ` +
              'Fix INBOUND_MAILBOXES or add the branch.',
          )
        }

        const outcome = await handleMessage(message, branch, asOf)
        if (outcome === 'created') created++
        else if (outcome === 'threaded') threaded++
        else duplicates++
      })
    } catch (error) {
      /*
        One mailbox failing does not stop the others.

        A password that expired on the Dubai account should cost Dubai's mail
        and nothing else, and the run still reports what it managed. The
        message stays unflagged either way, so the next tick retries it.
      */
      failed++
      console.error(
        { source: source.key, error: error instanceof Error ? error.message : String(error) },
        'inbound mail: mailbox failed',
      )
    }
  }

  return { collected, created, threaded, duplicates, failed }
}

interface BranchRef {
  readonly id: string
  readonly code: string
}

function mailboxBranchCode(user: string): string {
  return config.INBOUND_MAILBOXES.find((m) => m.user === user)?.branch ?? '?'
}

/** Mailbox address -> the branch that owns what arrives in it. */
async function resolveBranches(): Promise<Map<string, BranchRef>> {
  if (config.INBOUND_MAILBOXES.length === 0) return new Map()

  const rows = await withActor(systemActor(), async (tx) =>
    tx.select({ id: branches.id, code: branches.code }).from(branches),
  )

  const byCode = new Map(rows.map((b: BranchRef) => [b.code, b]))
  const byMailbox = new Map<string, BranchRef>()

  for (const box of config.INBOUND_MAILBOXES) {
    const branch = byCode.get(box.branch)
    if (branch) byMailbox.set(box.user, branch)
  }

  return byMailbox
}

type Outcome = 'created' | 'threaded' | 'duplicate'

/**
 * Claim, route, record.
 *
 * The attachment bytes are written to storage *before* the transaction opens,
 * for the reason `pdf/store.ts` sets out: a row pointing at bytes that were
 * never written is a download that 404s from a screen saying the file exists,
 * while bytes with no row are an orphan that costs pennies and confuses
 * nobody. Storage first, rows second.
 */
async function handleMessage(
  message: InboundMessage,
  branch: BranchRef,
  asOf: Date,
): Promise<Outcome> {
  const claim = await claimReceipt(message, branch.id)
  if (claim === 'already_processed') return 'duplicate'

  const stored = await storeAttachments(message, branch)

  try {
    const outcome = await withActor(systemActor(), async (tx) => {
      const target = await findTarget(tx, message)
      const customerId = await matchCustomer(tx, message.from)

      const context =
        target ??
        (await createEnquiry(tx, message, branch, customerId, asOf))

      const [row] = await tx
        .insert(messages)
        .values({
          branchId: branch.id,
          jobId: context.jobId,
          enquiryId: context.enquiryId,
          channel: 'email' as const,
          direction: 'inbound' as const,
          subject: message.subject || null,
          body: message.body,
          fromAddress: message.from || null,
          toAddresses: [...message.to],
          ccAddresses: [...message.cc],
          /*
            The sender's own `Message-ID`, so a later reply threads onto this
            row and so a re-poll of the same mail cannot make a second one.
          */
          externalRef: message.externalId,
          /*
            Visible to the customer only on the enquiry this mail just opened.

            The column defaults to `true`, which is right for the outbound half
            — we chose to send that. Inbound is the other way round: an agent's
            rate quotation and a haulier's excuse arrive on the job too, and a
            portal showing a customer their own file's buy-side correspondence
            is a commercial incident rather than a bug.

            Restricting it to `context.created` is narrower than "the sender is
            a customer contact", deliberately. `matchCustomer` identifies the
            *sender*, not the owner of the thread — so a mail from customer B's
            contact quoting customer A's job reference resolves a customer and
            a target that disagree, and trusting the sender alone would publish
            it to A. On a freshly created enquiry the two cannot disagree,
            because the enquiry was just created for that same customer.

            Everything else starts staff-only, and staff share it deliberately.
            That is the safe direction for a default nobody will revisit.
          */
          customerVisible: customerId !== null && context.created,
          sentAt: message.receivedAt,
        })
        .returning({ id: messages.id })

      for (const file of stored) {
        const [asset] = await tx
          .insert(assets)
          .values({
            branchId: branch.id,
            storageKey: file.storageKey,
            fileName: file.filename,
            contentType: file.contentType,
            byteSize: file.byteSize,
            checksum: file.checksum,
            meta: { source: 'inbound-email', mailbox: message.mailbox, oversized: file.oversized },
          })
          .returning({ id: assets.id })

        await tx
          .insert(messageAttachments)
          .values({ messageId: row!.id, assetId: asset!.id })
      }

      await tx
        .update(inboundWebhookEvents)
        .set({ processedAt: asOf, error: null, updatedAt: asOf })
        .where(eq(inboundWebhookEvents.id, claim.id))

      return context.created ? ('created' as const) : ('threaded' as const)
    })

    return outcome
  } catch (error) {
    /*
      The failure is recorded on the receipt and then rethrown.

      Rethrowing is what leaves the message unflagged in the mailbox, so the
      next run tries again; the recorded error is what makes a message that
      fails every time findable, rather than an enquiry queue that is quietly
      one short with the reason nowhere.
    */
    await withActor(systemActor(), async (tx) => {
      await tx
        .update(inboundWebhookEvents)
        .set({
          error: error instanceof Error ? error.message : String(error),
          updatedAt: asOf,
        })
        .where(eq(inboundWebhookEvents.id, claim.id))
    })
    throw error
  }
}

/**
 * The receipt, which is also the lock.
 *
 * An insert that conflicts means this message has been seen. Seen *and
 * processed* is a duplicate and is done with; seen and not processed is a run
 * that died part-way, and gets picked up where it stopped.
 */
async function claimReceipt(
  message: InboundMessage,
  branchId: string,
): Promise<{ id: string } | 'already_processed'> {
  return withActor(systemActor(), async (tx) => {
    const inserted = await tx
      .insert(inboundWebhookEvents)
      .values({
        provider: PROVIDER,
        externalId: message.externalId,
        /*
          The envelope, and deliberately not the attachments.

          `payload` is `jsonb` on a table whose own comment calls it "provider
          receipts, not business data". Base64ing a customer's 4MB commercial
          invoice into it would put shipment documents in an idempotency table,
          bloat every backup, and give two homes to a file that belongs in the
          object store. The bytes go to `FileStore`; this records what arrived.
        */
        payload: {
          mailbox: message.mailbox,
          branchId,
          from: message.from,
          fromName: message.fromName ?? null,
          to: message.to,
          cc: message.cc,
          subject: message.subject,
          receivedAt: message.receivedAt.toISOString(),
          inReplyTo: message.inReplyTo ?? null,
          references: message.references,
          attachments: message.attachments.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            byteSize: a.content.byteLength,
          })),
        },
      })
      .onConflictDoNothing()
      .returning({ id: inboundWebhookEvents.id })

    if (inserted.length > 0) return { id: inserted[0]!.id }

    const [existing] = await tx
      .select({ id: inboundWebhookEvents.id, processedAt: inboundWebhookEvents.processedAt })
      .from(inboundWebhookEvents)
      .where(
        and(
          eq(inboundWebhookEvents.provider, PROVIDER),
          eq(inboundWebhookEvents.externalId, message.externalId),
        ),
      )
      .limit(1)

    if (!existing || existing.processedAt) return 'already_processed'
    return { id: existing.id }
  })
}

interface Target {
  readonly enquiryId: string | null
  readonly jobId: string | null
  readonly created: boolean
}

/**
 * What this mail is about, if it is about anything we already hold.
 *
 * Two signals, tried in descending order of trust:
 *
 *  1. **A reference we issued**, found in the subject or the body. This is the
 *     one that works. Nobody in freight replies without the reference in the
 *     subject, because their own filing depends on it too.
 *
 *  2. **`In-Reply-To` / `References` against a message we sent.** Correct, and
 *     dormant: nothing writes an outbound `messages` row yet, and `sendMail`
 *     returns the relay's queue id rather than the `Message-ID` it generated.
 *     It is written now because the moment outbound threading exists this
 *     starts working with no further change, and because leaving it out would
 *     make somebody rediscover the ordering rule above.
 *
 * A reference that matches more than one row is treated as matching none —
 * `carrier-event.ts`'s rule, for the reason given at the top of this file.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findTarget(tx: any, message: InboundMessage): Promise<Target | null> {
  for (const reference of referencesIn(message.subject, message.body)) {
    if (reference.includes('-ENQ-')) {
      const rows = await tx
        .select({ id: enquiries.id })
        .from(enquiries)
        .where(eq(enquiries.reference, reference))
        .limit(2)
      if (rows.length === 1) return { enquiryId: rows[0]!.id, jobId: null, created: false }
    } else {
      const rows = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.reference, reference))
        .limit(2)
      if (rows.length === 1) return { enquiryId: null, jobId: rows[0]!.id, created: false }
    }
  }

  const threadIds = [
    ...new Set([message.inReplyTo, ...message.references].filter(Boolean) as string[]),
  ]

  for (const id of threadIds) {
    const rows = await tx
      .select({ enquiryId: messages.enquiryId, jobId: messages.jobId })
      .from(messages)
      .where(eq(messages.externalRef, id))
      .limit(2)

    if (rows.length === 1 && (rows[0]!.enquiryId || rows[0]!.jobId)) {
      return { enquiryId: rows[0]!.enquiryId, jobId: rows[0]!.jobId, created: false }
    }
  }

  return null
}

/**
 * Which customer sent this, if it can be said without guessing.
 *
 * Exact contact address first. Then the domain, but only where it belongs to
 * exactly one customer and is not a shared provider — FR-MD-10 already treats
 * an email domain as identifying for duplicate detection, so the concept is
 * the SRS's rather than an invention here.
 *
 * No match is a perfectly good answer and not an error: `enquiries` carries
 * `contact_email` and `contact_name` precisely so an unknown sender becomes a
 * lead rather than a rejection (FR-EQ-02).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function matchCustomer(tx: any, from: string): Promise<string | null> {
  const address = from.trim().toLowerCase()
  if (!address.includes('@')) return null

  const exact = await tx
    .select({ customerId: customerContacts.customerId })
    .from(customerContacts)
    .where(
      and(
        sql`lower(${customerContacts.email}) = ${address}`,
        eq(customerContacts.isActive, true),
      ),
    )
    .limit(2)

  if (exact.length === 1) return exact[0]!.customerId

  const domain = identifyingDomain(address)
  if (!domain) return null

  const byDomain = await tx
    .selectDistinct({ customerId: customerContacts.customerId })
    .from(customerContacts)
    .where(
      and(
        sql`lower(${customerContacts.email}) like ${'%@' + domain}`,
        eq(customerContacts.isActive, true),
      ),
    )
    .limit(2)

  return byDomain.length === 1 ? byDomain[0]!.customerId : null
}

/**
 * A new enquiry, with its clock started — FR-EQ-01, FR-EQ-02.
 *
 * The SLA is set here rather than left null because "one queue, one owner, one
 * clock" is the whole point of the intake: an emailed enquiry that arrived
 * without a due time would sit outside the SLA board and outside the
 * escalation worker, which is the invisible-work problem the system exists to
 * end. It is the same four working hours the web form applies, from the same
 * branch calendar.
 */
async function createEnquiry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  message: InboundMessage,
  branch: BranchRef,
  customerId: string | null,
  asOf: Date,
): Promise<Target> {
  const calendar = await loadCalendar(tx, branch.id)

  const result = await tx.execute(sql`select nextval('enquiry_reference_seq')::text as seq`)
  const seq = (result.rows[0] as { seq: string }).seq
  const reference = `${branch.code}-ENQ-${asOf.getUTCFullYear()}-${seq.padStart(5, '0')}`

  const [row] = await tx
    .insert(enquiries)
    .values({
      reference,
      branchId: branch.id,
      customerId,
      contactEmail: message.from || null,
      contactName: message.fromName ?? null,
      status: 'new' as const,
      channel: 'email',
      /*
        The subject, as the line the board shows.

        Not the body — that is the message row, and duplicating it here would
        give two places to correct a customer's words. The subject is the
        headline a coordinator triages on: "RFQ 2x40HC Shanghai to Shuwaikh"
        is the difference between a queue that can be worked and a list of
        identical rows reading "email".
      */
      notes: message.subject || null,
      slaStartedAt: asOf,
      slaDueAt: slaDueAt(asOf, FIRST_RESPONSE_MINUTES, calendar),
    })
    .returning({ id: enquiries.id, reference: enquiries.reference })

  // Same transaction as the insert, so a rollback takes the notification with
  // it — the transactional outbox, as everywhere else (§7.4).
  await tx.insert(notificationOutbox).values({
    branchId: branch.id,
    eventKey: 'enquiry.created',
    enquiryId: row!.id,
    customerId,
    payload: { reference: row!.reference },
  })

  return { enquiryId: row!.id, jobId: null, created: true }
}

async function loadCalendar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  branchId: string,
): Promise<WorkingCalendar> {
  const [row] = await tx
    .select({
      id: workingCalendars.id,
      timeZone: workingCalendars.timeZone,
      weekend: workingCalendars.weekend,
      startMinute: workingCalendars.dayStartMinute,
      endMinute: workingCalendars.dayEndMinute,
    })
    .from(branches)
    .innerJoin(workingCalendars, eq(workingCalendars.id, branches.calendarId))
    .where(eq(branches.id, branchId))
    .limit(1)

  if (!row) throw new Error(`branch ${branchId} has no working calendar`)

  const holidays = await tx
    .select({ onDate: calendarHolidays.onDate })
    .from(calendarHolidays)
    .where(eq(calendarHolidays.calendarId, row.id))

  return {
    id: row.id,
    timeZone: row.timeZone,
    weekend: row.weekend as WorkingCalendar['weekend'],
    holidays: new Set(holidays.map((h: { onDate: string }) => h.onDate)),
    hours: { startMinute: row.startMinute, endMinute: row.endMinute },
  }
}

interface StoredAttachment {
  readonly storageKey: string
  readonly filename: string
  readonly contentType: string
  readonly byteSize: number
  readonly checksum: string | null
  readonly oversized: boolean
}

async function storeAttachments(
  message: InboundMessage,
  branch: BranchRef,
): Promise<StoredAttachment[]> {
  if (message.attachments.length === 0) return []

  const fileStore = adapters().fileStore
  const out: StoredAttachment[] = []

  for (const [index, part] of message.attachments.entries()) {
    const key = inboundStorageKey(branch.code, message.receivedAt, message.externalId, part.filename, index)

    /*
      An oversized part was emptied by the adapter and is recorded, not stored.

      `INBOUND_MAIL_MAX_ATTACHMENT_MB` explains the trade: the enquiry is worth
      more than the file, so the mail is accepted either way and the row says a
      file arrived that we did not keep. Writing a zero-byte object would give
      a coordinator a download that succeeds and produces nothing, which is
      worse than a name with no link.
    */
    if (part.content.byteLength === 0) {
      out.push({
        storageKey: `oversized:${key}`,
        filename: part.filename,
        contentType: part.contentType,
        byteSize: 0,
        checksum: null,
        oversized: true,
      })
      continue
    }

    const stored = await fileStore.put(key, part.content, part.contentType)
    out.push({
      storageKey: stored.storageKey,
      filename: part.filename,
      contentType: part.contentType,
      byteSize: stored.byteSize,
      checksum: stored.checksum,
      oversized: false,
    })
  }

  return out
}
