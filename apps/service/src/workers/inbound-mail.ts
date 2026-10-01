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

import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  assets,
  branches,
  calendarHolidays,
  customerContacts,
  mailboxes,
  enquiries,
  partnerContacts,
  partners,
  inboundWebhookEvents,
  jobs,
  messageAttachments,
  messages,
  notificationDeliveries,
  notificationOutbox,
  rateRequests,
  systemActor,
  withActor,
  workingCalendars,
} from '@qabandi/db'
import { slaDueAt, type WorkingCalendar } from '@qabandi/core'
import { fileStore, resolveInboundMail } from '../adapters/index'
import type { InboundMailSource, InboundMessage } from '../ports/index'
import {
  identifyingDomain,
  inboundStorageKey,
  isAutomaticMail,
  referencesIn,
} from './inbound-routing'
import { rfqTokenIn } from './rfq-routing'

/** Enquiry SLA: four working hours to a first response — FR-EQ-01. */
const FIRST_RESPONSE_MINUTES = 4 * 60

/** The provider name on the receipt row. */
const PROVIDER = 'imap'

export interface InboundMailResult {
  readonly collected: number
  readonly created: number
  readonly threaded: number
  /** Broker replies routed to a rate request by their token — FR-RT-10. */
  readonly rateReplies: number
  readonly duplicates: number
  /** Bounces and auto-replies: claimed so they are never re-polled, filed nowhere. */
  readonly ignored: number
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
  injected?: readonly InboundMailSource[],
  enqueue: EnqueueExtraction = enqueueExtraction,
  billEnqueue: EnqueueBill = enqueueBill,
): Promise<InboundMailResult> {
  const sources = injected ?? (await resolveInboundMail())

  if (sources.length === 0) {
    return {
      collected: 0,
      created: 0,
      threaded: 0,
      rateReplies: 0,
      duplicates: 0,
      ignored: 0,
      failed: 0,
    }
  }

  const branchByMailbox = await resolveBranches()

  let collected = 0
  let created = 0
  let threaded = 0
  let rateReplies = 0
  let duplicates = 0
  let ignored = 0
  let failed = 0

  for (const source of sources) {
    const failedBefore = failed

    try {
      await source.collect(async (message) => {
        collected++

        try {
          const branch = branchByMailbox.get(message.mailbox)

          /*
            A mailbox whose branch code matches nothing is a configuration
            error, and it throws rather than filing the mail somewhere
            plausible. Throwing leaves the message unflagged, so nothing is lost
            while somebody fixes the code — and `branch_id` is not nullable on
            either `enquiries` or `messages`, so there is no somewhere-plausible
            to file it to in any case.

            It fails each message rather than the mailbox, like any other
            throw: every message after it fails the same way and just as fast,
            before anything is claimed, so aborting early would save nothing
            worth a second rule.
          */
          if (!branch) {
            throw new Error(
              `No active mailbox row matches ${message.mailbox}, so there is no ` +
                'branch to file its mail under. It was most likely deactivated ' +
                'between the poll starting and this message being handled.',
            )
          }

          const handled = await ingestMessage(
            message,
            branch,
            asOf,
            enqueue,
            undefined,
            billEnqueue,
          )
          if (handled.outcome === 'created') created++
          else if (handled.outcome === 'threaded') threaded++
          else if (handled.outcome === 'rate_reply') rateReplies++
          else if (handled.outcome === 'ignored') ignored++
          else duplicates++
        } catch (error) {
          /*
            One message failing costs that message, and is counted here.

            Rethrown, because the throw is how the source knows not to flag it
            — `\Seen` after a failure would lose the mail. The source catches
            it, carries on with the next message, and rejects once the batch
            is done (see `InboundMailSource`), which lands below.
          */
          failed++
          console.error(
            {
              source: source.key,
              messageId: message.externalId,
              error: error instanceof Error ? error.message : String(error),
            },
            'inbound mail: message failed, left unread for the next poll',
          )
          throw error
        }
      })
    } catch (error) {
      /*
        One mailbox failing does not stop the others.

        A password that expired on the Dubai account should cost Dubai's mail
        and nothing else, and the run still reports what it managed. The
        message stays unflagged either way, so the next tick retries it.

        Counted only where no message was: a source that rejects because its
        messages failed has had each of them counted already, and counting the
        rejection as well would report three failures for two mails.
      */
      if (failed === failedBefore) failed++
      console.error(
        { source: source.key, error: error instanceof Error ? error.message : String(error) },
        'inbound mail: mailbox failed',
      )
    }
  }

  return { collected, created, threaded, rateReplies, duplicates, ignored, failed }
}

export interface BranchRef {
  readonly id: string
  readonly code: string
}

/**
 * Mailbox address -> the branch that owns what arrives in it.
 *
 * A join rather than a lookup against configuration: the mapping is a column
 * on `mailboxes` now, so the branch a message belongs to is a fact the same
 * row already carries. One query per run, and it is the query that makes a
 * mailbox added on the settings screen work on the next tick.
 *
 * Keyed on the *username* because that is what the adapter stamps onto an
 * `InboundMessage`, and it is unique across the table by
 * `mailboxes_address_unique`.
 */
export async function resolveBranches(): Promise<Map<string, BranchRef>> {
  const rows = await withActor(systemActor(), async (tx) =>
    tx
      .select({
        username: mailboxes.username,
        id: branches.id,
        code: branches.code,
      })
      .from(mailboxes)
      .innerJoin(branches, eq(branches.id, mailboxes.branchId))
      .where(eq(mailboxes.isActive, true)),
  )

  return new Map(
    rows.map((r: { username: string; id: string; code: string }) => [
      r.username,
      { id: r.id, code: r.code },
    ]),
  )
}

type Outcome = 'created' | 'threaded' | 'duplicate' | 'ignored' | 'rate_reply'

/**
 * What `handleMessage` did, and what a model should read next.
 *
 * The ids come back rather than being acted on inside the transaction,
 * because the enqueue must happen *after* the commit — see `enqueueExtraction`
 * below, where the ordering is the whole design.
 */
interface Handled {
  readonly outcome: Outcome
  readonly enquiryId: string | null
  readonly messageId: string | null
  /** The supplier this mail came from, where the sender resolved to exactly one. */
  readonly partnerId: string | null
  /** The RFQ this mail answered, where it carried a token that matched one. */
  readonly rateRequestId: string | null
}

/**
 * Ask a model to read the mail we just filed — FR-EQ-02's twelve null columns.
 *
 * Injected, with a default that resolves pg-boss lazily, for the reason every
 * other boundary in this worker is injected: the suite proves what becomes an
 * enquiry against a real database and has no queue, and a static import of
 * `getBoss` here would make `inbound-mail.test.ts` require one.
 *
 * Failure is swallowed and logged. This is enrichment of a row that already
 * exists, and the whole argument for extraction being a job rather than a step
 * is that nothing about a model may cost us an intake — letting a failed
 * enqueue throw here would put that back, one `await` at a time.
 */
export type EnqueueExtraction = (input: {
  enquiryId: string
  messageId: string
  branchId: string
}) => Promise<void>

const enqueueExtraction: EnqueueExtraction = async (input) => {
  const { JOBS, getBoss } = await import('../queue')
  const boss = await getBoss()
  await boss.send(JOBS.enquiryExtract, input)
}

/**
 * Ask a model to read a bill that arrived as an attachment — FR-FN-09, `AI-10`.
 *
 * The other half of the same idea, and the one with the money in it.
 * `invoice-extract.ts` has been able to read a supplier invoice since it was
 * written, and `core/matching.ts` has been able to find the agent who billed
 * 460 against a 400 accrual for longer than that. Neither ever ran unattended,
 * because `JOBS.invoiceExtract` was registered as a worker and *nothing in the
 * codebase ever enqueued it*. The handler was mounted and unreachable.
 *
 * This is the enqueuer. An agent's invoice arriving overnight is captured and
 * sitting against its accrual before anybody opens the office.
 */
export type EnqueueBill = (input: {
  branchId: string
  assetId: string
  partnerId: string
}) => Promise<void>

const enqueueBill: EnqueueBill = async (input) => {
  const { JOBS, getBoss } = await import('../queue')
  const boss = await getBoss()
  await boss.send(JOBS.invoiceExtract, {
    actor: systemActor([input.branchId]),
    branchId: input.branchId,
    assetId: input.assetId,
    partnerId: input.partnerId,
    jobId: null,
    /*
      Written, not merely reported.

      The attended path pre-fills a form somebody is standing in front of, so
      writing behind them would leave two records. Nobody is standing in front
      of this one — and the bill lands in `received`, which is the draft gate
      `supplier_invoices` has always had. Finance still approves before a fils
      moves.
    */
    write: true,
  })
}

/**
 * Ask a model to read a broker's rate reply — FR-RT-10, `rate_extract`.
 *
 * The third enqueuer, and the same shape as the two above for the same reason:
 * the reply is filed inside the transaction, the model is asked after it
 * commits, and a queue that is down costs a stale comparison, never the record
 * of the reply. Injected so `inbound-mail.test.ts` can assert an RFQ reply was
 * routed without standing up pg-boss.
 */
export type EnqueueRateExtract = (input: {
  branchId: string
  rateRequestId: string
  messageId: string
}) => Promise<void>

const enqueueRateExtract: EnqueueRateExtract = async (input) => {
  const { JOBS, getBoss } = await import('../queue')
  const boss = await getBoss()
  await boss.send(JOBS.rateExtract, input)
}

/**
 * What an attachment has to be before it is worth sending to a model.
 *
 * A deliberately loose filter, because the real one is arithmetic. Anything
 * that is not an invoice — a packing list, a photograph of a seal — fails
 * `isSelfConsistent` and writes nothing, so the cost of guessing wrong is one
 * cheap call rather than a junk payable. Tightening this into "files whose
 * name contains INV" would instead lose the agent whose system names every
 * attachment `document.pdf`.
 */
const READABLE_BILL = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

/**
 * Claim, route, record.
 *
 * The attachment bytes are written to storage *before* the transaction opens,
 * for the reason `pdf/store.ts` sets out: a row pointing at bytes that were
 * never written is a download that 404s from a screen saying the file exists,
 * while bytes with no row are an orphan that costs pennies and confuses
 * nobody. Storage first, rows second.
 */
export async function ingestMessage(
  message: InboundMessage,
  branch: BranchRef,
  asOf: Date,
  enqueue: EnqueueExtraction = enqueueExtraction,
  /**
   * A receipt this message already holds, where the caller claimed it.
   *
   * The webhook half of `InboundMailSource` arrives having *already* inserted
   * its `inbound_webhook_events` row — that insert is what makes a provider's
   * redelivery a no-op, and it happens in the route before anything is queued.
   * Claiming a second one here under a different provider would leave the
   * first row permanently unprocessed and give one mail two receipts.
   *
   * So the poll claims and the webhook passes; both then run the identical
   * rules about what becomes an enquiry, which is the entire reason
   * `InboundMessage` exists as a port shape rather than an IMAP detail.
   */
  claimed?: { readonly id: string },
  billEnqueue: EnqueueBill = enqueueBill,
  rfqEnqueue: EnqueueRateExtract = enqueueRateExtract,
): Promise<Handled> {
  const claim = claimed ?? (await claimReceipt(message, branch.id))
  if (claim === 'already_processed') {
    return {
      outcome: 'duplicate',
      enquiryId: null,
      messageId: null,
      partnerId: null,
      rateRequestId: null,
    }
  }

  /*
    A machine's mail is claimed and then ignored — in that order.

    Claimed, because the receipt is what stops the next poll collecting the
    same bounce again; an ignored message that was not claimed would be
    ignored every minute forever. Ignored *after* claiming and *before*
    anything else, because everything below — storage, an enquiry, an SLA
    clock, a notification to the sender, a model call — is what turned one
    bounce into a hundred and eighty-nine enquiries: the notification went to
    the daemon, the daemon bounced it, the bounce was the next enquiry.

    Stamped processed with the reason on the receipt rather than left blank,
    so "why did this mail never appear" has an answer somebody can find.
  */
  if (isAutomaticMail(message)) {
    await withActor(systemActor(), async (tx) => {
      const bounced = message.bounceOf
        ? await markBounced(tx, message.bounceOf, asOf)
        : { deliveries: 0 }

      await tx
        .update(inboundWebhookEvents)
        .set({
          processedAt: asOf,
          error:
            bounced.deliveries > 0
              ? `ignored: automatic mail (bounce of ${message.bounceOf!.messageId}; ` +
                `deliveries marked failed: ${bounced.deliveries})`
              : 'ignored: automatic mail',
          updatedAt: asOf,
        })
        .where(eq(inboundWebhookEvents.id, claim.id))
    })
    return {
      outcome: 'ignored',
      enquiryId: null,
      messageId: null,
      partnerId: null,
      rateRequestId: null,
    }
  }

  /** Asset ids worth reading as a supplier invoice, filled inside the transaction. */
  const bills: string[] = []

  try {
    /*
      Inside the `try`, so a storage failure is written on the receipt.

      It used to sit one line above it. The receipt was already claimed, so
      a bucket that refused the bytes — "Object storage is not configured" —
      threw straight past the catch below: the row stayed unprocessed with
      `error` empty, and the only record of why three mails were stuck behind
      a PDF was a log line nobody was reading.
    */
    const stored = await storeAttachments(message, branch)

    const outcome = await withActor(systemActor(), async (tx) => {
      /*
        The receipt, locked for the length of this transaction — and re-read.

        Two runs can hold the same receipt: two service instances polling one
        mailbox, a webhook job and its re-drive (`inbound-redrive.ts`), or a
        provider redelivery that re-queued a job still running. `claimReceipt`
        hands an unprocessed receipt to each of them as resumable, which is
        right for a run that died part-way and wrong for one that is still
        going: both filed the mail. The row lock makes the second wait for the
        first to commit; it then reads `processed_at` and stops, having
        written nothing.
      */
      const [receipt] = await tx
        .select({ processedAt: inboundWebhookEvents.processedAt })
        .from(inboundWebhookEvents)
        .where(eq(inboundWebhookEvents.id, claim.id))
        .for('update')
      if (receipt?.processedAt) {
        return {
          outcome: 'duplicate' as const,
          enquiryId: null,
          messageId: null,
          partnerId: null,
          rateRequestId: null,
        }
      }

      const target = await findTarget(tx, message)
      const customerId = await matchCustomer(tx, message)
      /*
        The sender may be a supplier as well as — or instead of — a customer.

        Both matches run because the two are not exclusive: an overseas agent
        is a partner on our payables and, on their own imports, a customer on
        our receivables. `matchPartner` decides only whose *bill* an attachment
        is, and refuses two candidates exactly as `matchCustomer` does.
      */
      const partnerId = await matchPartner(tx, message.from)

      /*
        A broker's reply to a rate request we sent — FR-RT-10.

        Recognised by the opaque token the send worker stamped into the subject,
        which is stronger evidence than the enquiry reference `findTarget` reads:
        one enquiry is sent to five agents, so only the token says *which*
        request a reply answers. When it matches, this mail is threaded onto the
        enquiry we asked about and **never opens a new one** — an agent's rate
        quotation is not a customer enquiry, and letting it fall through to
        `createEnquiry` would put a broker's price on the board as a shipment
        request. The row is filed, the request moves to `responded`, and a model
        reads the charges after the commit.

        That holds whatever state the request is in. Only `sent` and
        `responded` used to match, so the agent's *second* mail — "revised rate
        attached" after the first was read, the real quote after an auto-ack,
        any reply to a renewal RFQ that has no enquiry — fell through to
        `createEnquiry` and landed on the board as a customer's shipment, with
        an SLA clock, a model call and, with auto-fanout on, RFQs about itself.
        A request already read or decided is not reopened (`late`, below): the
        mail is filed on its enquiry and a person is told.
      */
      const rfqToken = rfqTokenIn(message.subject ?? null, message.body)
      const matched = rfqToken ? await findRateRequestByToken(tx, rfqToken, branch.id) : null
      const rateRequest = matched && AWAITING_REPLY.has(matched.status) ? matched : null
      const late = matched && !rateRequest ? matched : null

      const context = matched
        ? { enquiryId: matched.enquiryId, jobId: null, created: false }
        : (target ?? (await createEnquiry(tx, message, branch, customerId, asOf)))

      const [row] = await tx
        .insert(messages)
        .values({
          branchId: branch.id,
          jobId: context.jobId,
          enquiryId: context.enquiryId,
          channel: message.channel ?? 'email',
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
            meta: {
              source: message.channel === 'whatsapp' ? 'inbound-whatsapp' : 'inbound-email',
              mailbox: message.mailbox,
              oversized: file.oversized,
            },
          })
          .returning({ id: assets.id })

        await tx.insert(messageAttachments).values({ messageId: row!.id, assetId: asset!.id })

        /*
          A readable attachment from a known supplier is a bill to read.

          Collected inside the transaction and enqueued after it commits, for
          the same reason the enquiry extraction is: a job that referred to an
          asset row the transaction then rolled back would fail five times
          against something that was never there.

          `oversized` files are skipped. The adapter stores those as a stub
          rather than the bytes — a 40MB scan past the mailbox's limit — and
          asking a model to read a placeholder costs money to learn nothing.
        */
        if (partnerId && !file.oversized && READABLE_BILL.has(file.contentType)) {
          bills.push(asset!.id)
        }
      }

      /*
        The request moves to `responded` in the same transaction that filed the
        reply, so a crash between the two can never leave a stored reply against
        a request that still reads `sent`. The model is asked after the commit.
      */
      if (rateRequest) {
        await tx
          .update(rateRequests)
          .set({ status: 'responded', respondedAt: asOf, messageId: row!.id, updatedAt: asOf })
          .where(eq(rateRequests.id, rateRequest.id))
      }

      /*
        A reply to a request that was already read, decided or replaced.

        Filed — on the enquiry, or unattached for a renewal RFQ, which has none
        — and *not* re-read: the request keeps its status, its parsed figures
        and any card already promoted from it, because a model overwriting an
        accepted award with a later mail is a decision nobody made. Whether the
        new mail changes anything is a person's call, so a person is told, on
        the internal channel the variance alarm uses. The receipt says the same
        thing for whoever looks there first.
      */
      if (late) {
        await tx.insert(notificationOutbox).values({
          branchId: branch.id,
          eventKey: 'rate_request.late_reply',
          enquiryId: late.enquiryId,
          payload: {
            reference: late.enquiryReference ?? late.token,
            partnerName: late.partnerName,
          },
        })
      }

      await tx
        .update(inboundWebhookEvents)
        .set({
          processedAt: asOf,
          error: late
            ? `rate reply to a request already ${late.status}: filed, not re-read; ` +
              'a person has been told'
            : null,
          updatedAt: asOf,
        })
        .where(eq(inboundWebhookEvents.id, claim.id))

      return {
        outcome: matched
          ? ('rate_reply' as const)
          : context.created
            ? ('created' as const)
            : ('threaded' as const),
        enquiryId: context.enquiryId,
        messageId: row!.id,
        partnerId,
        rateRequestId: rateRequest?.id ?? null,
      }
    })

    /*
      The model is asked *after* the commit, and only for an enquiry this mail
      opened — `AI-05`.

      After, because an enquiry that never arrived is a customer who went
      elsewhere: extraction is an enrichment of a row that already exists, and
      nothing about a model may sit between a mail and the board.

      Only for a new enquiry, because a reply threaded onto an existing one had
      its cargo facts proposed when the first mail arrived, and re-reading every
      "any update?" would spend money to propose the same twelve values against
      columns a coordinator has since filled.

      Wrapped rather than awaited bare, for the same reason once more: a queue
      that is down costs this deployment a slower coordinator, never an intake.
    */
    if (outcome.outcome === 'created' && outcome.enquiryId && outcome.messageId) {
      try {
        await enqueue({
          enquiryId: outcome.enquiryId,
          messageId: outcome.messageId,
          branchId: branch.id,
        })
      } catch (error) {
        console.error(
          {
            enquiryId: outcome.enquiryId,
            error: error instanceof Error ? error.message : String(error),
          },
          'inbound mail: could not queue the enquiry for reading',
        )
      }
    }

    /*
      The bills, after the commit and independently of the enquiry.

      Independently, because the two are not the same event: an agent's invoice
      usually arrives as a reply on a job — `threaded`, not `created` — and
      gating it on a new enquiry would mean the only bills ever read were the
      ones from suppliers who had never written to us before.

      One failure does not stop the rest, and none of them stops the mail. A
      bill nobody read is a bill somebody types, which is where they were
      before this existed.
    */
    for (const assetId of bills) {
      try {
        await billEnqueue({ branchId: branch.id, assetId, partnerId: outcome.partnerId! })
      } catch (error) {
        console.error(
          { assetId, error: error instanceof Error ? error.message : String(error) },
          'inbound mail: could not queue the attachment for reading',
        )
      }
    }

    /*
      A matched RFQ reply, after the commit — FR-RT-10.

      The bills above already read attachments from a known supplier; this reads
      the reply itself for the charges in its body, and writes them to the
      request as a proposal a coordinator ranks and accepts. Wrapped like the
      rest: a down queue leaves the reply filed and the request `responded`, and
      a re-run of the poll cannot re-file it, because the receipt is claimed.
    */
    if (outcome.rateRequestId && outcome.messageId) {
      try {
        await rfqEnqueue({
          branchId: branch.id,
          rateRequestId: outcome.rateRequestId,
          messageId: outcome.messageId,
        })
      } catch (error) {
        console.error(
          {
            rateRequestId: outcome.rateRequestId,
            error: error instanceof Error ? error.message : String(error),
          },
          'inbound mail: could not queue the rate reply for reading',
        )
      }
    }

    return outcome
  } catch (error) {
    /*
      The failure is recorded on the receipt and then rethrown.

      Rethrowing is what leaves the message unflagged in the mailbox, so the
      next run tries again; the recorded error is what makes a message that
      fails every time findable, rather than an enquiry queue that is quietly
      one short with the reason nowhere.

      Recording is best-effort. When the database itself is what failed, the
      write fails too, and letting *that* error escape would replace the real
      reason with "connection refused" in every log line after it.
    */
    await withActor(systemActor(), async (tx) => {
      await tx
        .update(inboundWebhookEvents)
        .set({
          error: error instanceof Error ? error.message : String(error),
          updatedAt: asOf,
        })
        .where(eq(inboundWebhookEvents.id, claim.id))
    }).catch((recording: unknown) => {
      console.error(
        {
          receipt: claim.id,
          error: recording instanceof Error ? recording.message : String(recording),
        },
        'inbound mail: could not record the failure on the receipt',
      )
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

/**
 * A bounce, tied back to the delivery that said `sent` — FR-NT-06.
 *
 * The dispatcher marks a row `sent` the moment the relay accepts it, which is
 * all it can know at the time; the recipient's server refusing it arrives
 * minutes later as a bounce in a polled inbox, and was until now ignored as
 * automatic mail and forgotten. The notification then read as delivered to an
 * address that does not exist, which is the one thing FR-NT-06's delivery
 * states are for telling an operator.
 *
 * Matched on `external_ref`, which holds the `Message-ID` `sendMail` minted
 * (see `smtp.ts`). Only `sent` and `delivered` rows move — a `failed` one is
 * already right, and a `queued` one has not been sent, so a bounce naming it
 * is quoting some other message and is left alone. A bounce matching nothing
 * — mail the password-reset route sent, a row from before `external_ref`
 * held the id, somebody else's message — changes nothing and is ignored
 * exactly as before.
 *
 * The same transaction as the receipt's processed stamp, so a bounce is
 * never marked done without its delivery having been told.
 */
async function markBounced(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  bounce: NonNullable<InboundMessage['bounceOf']>,
  asOf: Date,
): Promise<{ deliveries: number }> {
  const rows = await tx
    .update(notificationDeliveries)
    .set({
      status: 'failed' as const,
      failedAt: asOf,
      lastError: `bounced: ${bounce.reason}`,
      updatedAt: asOf,
    })
    .where(
      and(
        eq(notificationDeliveries.externalRef, bounce.messageId),
        inArray(notificationDeliveries.status, ['sent', 'delivered']),
      ),
    )
    .returning({ id: notificationDeliveries.id })

  return { deliveries: rows.length }
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
 *     dormant: nothing writes an outbound `messages` row yet. (`sendMail` now
 *     returns the `Message-ID` it generated, so the other half is in place.)
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
/**
 * The sender, matched to a *partner* — the supplier half of attribution.
 *
 * Deliberately the same shape as `matchCustomer` below, including the refusal:
 * an exact contact address first, then a domain belonging to exactly one
 * partner, and two candidates means none. The stakes are the same in a
 * different direction — `matchCustomer` decides whose correspondence a
 * customer can see, and this decides *whose bill we are about to capture*.
 * Attributing an invoice to the wrong agent puts a payable on a party that
 * never sent it, against accruals that belong to somebody else.
 *
 * `invoice-extract.ts` refuses to read the supplier off the letterhead for
 * exactly this reason: the caller is supposed to know. On the attended path
 * the caller is a coordinator standing on a screen; here it is the mailbox the
 * bill arrived from, which is the only other evidence worth trusting.
 */
async function matchPartner(tx: any, from: string): Promise<string | null> {
  const address = from.trim().toLowerCase()
  if (!address.includes('@')) return null

  const exact = await tx
    .select({ partnerId: partnerContacts.partnerId })
    .from(partnerContacts)
    .where(
      and(sql`lower(${partnerContacts.email}) = ${address}`, eq(partnerContacts.isActive, true)),
    )
    .limit(2)

  if (exact.length === 1) return exact[0]!.partnerId

  const domain = identifyingDomain(address)
  if (!domain) return null

  const byDomain = await tx
    .selectDistinct({ partnerId: partnerContacts.partnerId })
    .from(partnerContacts)
    .where(
      and(
        sql`lower(${partnerContacts.email}) like ${'%@' + domain}`,
        eq(partnerContacts.isActive, true),
      ),
    )
    .limit(2)

  return byDomain.length === 1 ? byDomain[0]!.partnerId : null
}

/** The request states a reply is read into; any other state is a late reply. */
const AWAITING_REPLY = new Set(['sent', 'responded'])

/**
 * The rate request a reply's token names, scoped to the branch — FR-RT-10.
 *
 * `token` is unique across the table, so the branch predicate is a guard rather
 * than a tiebreak: a token that resolves to another branch's request is treated
 * as no match, and the reply falls through to the ordinary rules. Every status
 * matches — the caller decides what a reply to a decided request does — so a
 * token we issued can never open an enquiry.
 */
async function findRateRequestByToken(
  tx: any,
  token: string,
  branchId: string,
): Promise<{
  id: string
  enquiryId: string | null
  status: string
  token: string
  partnerName: string
  enquiryReference: string | null
} | null> {
  const rows = await tx
    .select({
      id: rateRequests.id,
      enquiryId: rateRequests.enquiryId,
      status: rateRequests.status,
      token: rateRequests.token,
      partnerName: partners.legalNameEn,
      enquiryReference: enquiries.reference,
    })
    .from(rateRequests)
    .innerJoin(partners, eq(partners.id, rateRequests.partnerId))
    .leftJoin(enquiries, eq(enquiries.id, rateRequests.enquiryId))
    .where(and(eq(rateRequests.token, token), eq(rateRequests.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Whose enquiry this is, if the sender is a known customer contact.
 *
 * The one place the two channels genuinely differ. Email matches on the address;
 * WhatsApp matches on the phone number. Both refuse two matches as they refuse
 * none — `carrier-event.ts`'s rule — because a message filed under the wrong
 * customer is worse than one a coordinator files by hand.
 */
async function matchCustomer(tx: any, message: InboundMessage): Promise<string | null> {
  return message.channel === 'whatsapp'
    ? matchCustomerByPhone(tx, message.from)
    : matchCustomerByEmail(tx, message.from)
}

async function matchCustomerByEmail(tx: any, from: string): Promise<string | null> {
  const address = from.trim().toLowerCase()
  if (!address.includes('@')) return null

  const exact = await tx
    .select({ customerId: customerContacts.customerId })
    .from(customerContacts)
    .where(
      and(sql`lower(${customerContacts.email}) = ${address}`, eq(customerContacts.isActive, true)),
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
 * A customer contact by phone, compared digits-only.
 *
 * A number is stored however a person typed it — `+965 2220 1234`, `2220-1234` —
 * and WhatsApp hands over the bare `9652220 1234` of an E.164 number with no
 * punctuation and no `+`. Stripping both to digits is what makes those the same
 * contact. There is no domain fallback the way email has one: a phone number
 * identifies one person, not an organisation, so an unrecognised number opens an
 * enquiry a coordinator triages rather than guessing at a customer.
 */
async function matchCustomerByPhone(tx: any, from: string): Promise<string | null> {
  const digits = from.replace(/[^0-9]/g, '')
  // Too short to identify anyone — a stray digit or two is not a phone number,
  // and a loose match here files a stranger's message under a real customer.
  if (digits.length < 7) return null

  const rows = await tx
    .selectDistinct({ customerId: customerContacts.customerId })
    .from(customerContacts)
    .where(
      and(
        sql`regexp_replace(coalesce(${customerContacts.phone}, ''), '[^0-9]', '', 'g') = ${digits}`,
        eq(customerContacts.isActive, true),
      ),
    )
    .limit(2)

  return rows.length === 1 ? rows[0]!.customerId : null
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
      /*
        `contactEmail` holds the address for email and stays null for WhatsApp —
        the column is an email column, and a phone number in it would resolve to
        a customer nobody can mail. The number is on the `messages` row's
        `fromAddress` and on the resolved customer instead.
      */
      contactEmail: message.channel === 'whatsapp' ? null : message.from || null,
      contactName: message.fromName ?? null,
      status: 'new' as const,
      channel: message.channel ?? 'email',
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

  /*
    The customer's acknowledgement — FR-NT-01, and the loop breaker is which
    address it can reach.

    Raised only when the sender resolved to a customer, because the dispatcher
    sends it to that customer's *on-file* contact, never to the raw address the
    mail came from. An unknown sender opens an enquiry a coordinator triages by
    hand and hears nothing automatic — which is the rule `Operations_Findings
    §11` was written in blood for: acknowledge whoever wrote in, and the day a
    mail daemon writes in, its bounce is the next thing acknowledged. Bounces
    and auto-replies never reach here anyway (`isAutomaticMail` files them
    before this), so this is the second lock on the same door.
  */
  if (customerId) {
    await tx.insert(notificationOutbox).values({
      branchId: branch.id,
      eventKey: 'enquiry.received',
      enquiryId: row!.id,
      customerId,
      payload: { reference: row!.reference },
    })
  }

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

  const store = await fileStore()
  const out: StoredAttachment[] = []

  for (const [index, part] of message.attachments.entries()) {
    const key = inboundStorageKey(
      branch.code,
      message.receivedAt,
      message.externalId,
      part.filename,
      index,
    )

    /*
      An oversized part was emptied by the adapter and is recorded, not stored.

      the mailbox's `max_attachment_mb` explains the trade: the enquiry is worth
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

    const stored = await store.put(key, part.content, part.contentType)
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
