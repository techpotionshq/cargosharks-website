/**
 * Inbound mail onto the board — the attribution rules.
 *
 * Two halves, and they fail differently. **Which shipment a mail is about** is
 * decided by `referencesIn` and `identifyingDomain`, both pure and both tested
 * here against no infrastructure — they are the decisions that put one
 * customer's correspondence in front of another when they are wrong, and a
 * wrong answer is silent. **What is then written** needs a database, and those
 * cases are below the fold on `TEST_DATABASE_URL`.
 *
 * The rule the pure half exists to defend: **a reference that matches more
 * than one row is treated as matching none**, and a sender is identified by
 * their domain only where that domain belongs to one customer and is not a
 * shared mail provider. `carrier-event.ts` argues the first at length for
 * container numbers. The second is the same argument about `gmail.com`: one
 * customer contact with a Gmail address would otherwise make every cold
 * enquiry from any Gmail user that customer's, with their rates attached.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { identifyingDomain, inboundStorageKey, referencesIn } from './inbound-routing'

// --- reference extraction ----------------------------------------------------

describe('referencesIn', () => {
  it('finds an enquiry reference in a reply subject', () => {
    expect(referencesIn('Re: KWI-ENQ-2026-00042 — rates', '')).toEqual(['KWI-ENQ-2026-00042'])
  })

  it('finds a job reference quoted in the body', () => {
    expect(referencesIn('Documents', 'Attached against FXH-JOB-2026-00001, thanks.')).toEqual([
      'FXH-JOB-2026-00001',
    ])
  })

  it('reads the subject before the body', () => {
    expect(referencesIn('Re: KWI-ENQ-2026-00042', 'was FXH-JOB-2026-00001')).toEqual([
      'KWI-ENQ-2026-00042',
      'FXH-JOB-2026-00001',
    ])
  })

  /**
   * A `Re: Re: Re:` chain quotes the same reference in every nested copy. Left
   * undeduplicated the worker would run the same lookup a dozen times per
   * mail — harmless, but the ordering guarantee is what actually matters and
   * this is where it is stated.
   */
  it('collapses a reference quoted repeatedly down a reply chain', () => {
    const body = 'On Tue, KWI-ENQ-2026-00042 wrote:\n> KWI-ENQ-2026-00042\n>> KWI-ENQ-2026-00042'
    expect(referencesIn('Re: KWI-ENQ-2026-00042', body)).toEqual(['KWI-ENQ-2026-00042'])
  })

  /**
   * The bug this is here to catch.
   *
   * Freight mail is dense with identifiers that look like ours — container
   * numbers, bill numbers, booking references, dates. A pattern loose enough
   * to catch a reference typed slightly wrong is loose enough to thread a mail
   * onto a shipment it has nothing to do with, and nobody would find out until
   * a customer saw somebody else's file.
   */
  it('does not match the other identifiers a freight email is full of', () => {
    const noise = [
      'MRKU1234567',
      'MAEU-123456789',
      'BL-2026-00042',
      'KWI-2026-00042',
      'KWI-ENQ-2026-0042',
      'KWI-ENQ-26-00042',
      'INV-KWI-2026-00042',
      '2026-08-18',
    ].join('\n')

    expect(referencesIn('Shipment update', noise)).toEqual([])
  })

  it('is empty for a cold enquiry that quotes nothing', () => {
    expect(referencesIn('Rates Shanghai to Shuwaikh?', 'Please quote 2x40HC ready 25 Aug.')).toEqual(
      [],
    )
  })

  it('does not match a reference glued to surrounding text', () => {
    expect(referencesIn('', 'refKWI-ENQ-2026-00042x')).toEqual([])
  })
})

// --- sender identification ---------------------------------------------------

describe('identifyingDomain', () => {
  it('accepts a corporate domain', () => {
    expect(identifyingDomain('fatima@shipper.com.kw')).toBe('shipper.com.kw')
  })

  it('is case and whitespace insensitive', () => {
    expect(identifyingDomain('  Fatima@Shipper.COM.KW ')).toBe('shipper.com.kw')
  })

  /**
   * The rule that stops one Gmail-using contact turning every Gmail sender
   * into that customer. The "exactly one customer" check downstream would pass
   * for a small deployment with a single such contact — which is exactly the
   * deployment this is being sold into first.
   */
  it('refuses the shared providers', () => {
    for (const address of [
      'someone@gmail.com',
      'someone@GMAIL.COM',
      'someone@hotmail.com',
      'someone@outlook.com',
      'someone@yahoo.com',
      'someone@icloud.com',
      'someone@qq.com',
    ]) {
      expect(identifyingDomain(address)).toBeNull()
    }
  })

  it('refuses anything that is not an address', () => {
    for (const junk of ['', 'not-an-address', '@nothing.com', 'trailing@', 'no@tld']) {
      expect(identifyingDomain(junk)).toBeNull()
    }
  })

  /** A `user@a@b.com` is malformed; the last `@` is the one that counts. */
  it('takes the domain after the last at-sign', () => {
    expect(identifyingDomain('odd@name@shipper.com.kw')).toBe('shipper.com.kw')
  })
})

// --- storage keys ------------------------------------------------------------

describe('inboundStorageKey', () => {
  const received = new Date('2026-08-18T07:14:00Z')

  it('files an attachment under its branch, year and message', () => {
    expect(inboundStorageKey('KWI', received, '<c1@shipper.com.kw>', 'packing-list.pdf', 0)).toBe(
      'inbound/KWI/2026/c1-shipper.com.kw/0-packing-list.pdf',
    )
  })

  /**
   * The bug this is here to catch.
   *
   * The filename is the *sender's*, and a sender may call a file anything at
   * all. An unsanitised name goes straight into an object-storage key, and
   * `../` in a key is a write outside the prefix this deployment believes it
   * is confined to.
   */
  it('neutralises a filename attempting to escape its prefix', () => {
    const key = inboundStorageKey('KWI', received, '<x@y.com>', '../../../etc/passwd', 0)
    expect(key).not.toContain('..')
    expect(key).toBe('inbound/KWI/2026/x-y.com/0-.-.-.-etc-passwd')
  })

  it('neutralises a filename in a script or a foreign alphabet', () => {
    const key = inboundStorageKey('KWI', received, '<x@y.com>', 'قائمة التعبئة.pdf', 0)
    expect(key).toMatch(/^inbound\/KWI\/2026\/x-y\.com\/0-[A-Za-z0-9._-]+$/)
  })

  it('keeps two attachments of one message apart', () => {
    const a = inboundStorageKey('KWI', received, '<x@y.com>', 'invoice.pdf', 0)
    const b = inboundStorageKey('KWI', received, '<x@y.com>', 'invoice.pdf', 1)
    expect(a).not.toBe(b)
  })

  it('bounds a filename long enough to break a storage key', () => {
    const key = inboundStorageKey('KWI', received, '<x@y.com>', `${'a'.repeat(4000)}.pdf`, 0)
    expect(key.length).toBeLessThan(200)
  })
})

// --- against a database ------------------------------------------------------

/**
 * The rules above decide *what* a mail is about. These decide what gets
 * written, and they need the real schema: the SLA clock comes off the branch's
 * working calendar, the reference off a sequence, and the duplicate refusal
 * off a unique index. A mock of any of the three would pass while the column
 * it stands for was wrong.
 *
 * No IMAP server is involved. `runInboundMailPoll` takes its sources as a
 * parameter, so the test hands over messages directly — which is the seam
 * `InboundMailSource` was defined to provide.
 */

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const MAILBOX = 'kuwait-fixture@qabandi.test'
const ORPHAN_MAILBOX = 'nowhere-fixture@qabandi.test'

/*
  Set before the modules below are imported.

  `config.ts` and `secrets.ts` both read `process.env`, and `secrets.ts` needs a
  key to seal the fixture mailbox's password with — the column has a database
  constraint requiring sealed ciphertext, so an unsealed fixture cannot be
  inserted at all. A throwaway key: this one seals nothing that outlives the
  suite.
*/
process.env.MAILBOX_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
// Attachments go to memory rather than to a bucket this suite has no key for.
process.env.FILE_STORE_DRIVER = 'memory'

const {
  assets,
  branches,
  customerContacts,
  customers,
  enquiries,
  inboundWebhookEvents,
  mailboxes,
  messageAttachments,
  messages,
  notificationOutbox,
  principals,
  sealSecret,
  systemActor,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { runInboundMailPoll } = await import('./inbound-mail')

const BRANCH = '00000000-0000-7000-8000-0000000ab001'
const CUSTOMER = '00000000-0000-7000-8000-0000000ab002'
const PRINCIPAL = '00000000-0000-7000-8000-0000000ab003'

const sys = systemActor()
const RUN = process.hrtime.bigint().toString(36).toUpperCase().slice(-6)
let seq = 0

interface FakeMessage {
  externalId?: string
  mailbox?: string
  from?: string
  fromName?: string
  subject?: string
  body?: string
  attachments?: { filename: string; contentType: string; content: Buffer }[]
  inReplyTo?: string
  references?: string[]
}

function mail(over: FakeMessage = {}) {
  seq += 1
  return {
    externalId: over.externalId ?? `<${RUN}-${seq}@shipper.test>`,
    mailbox: over.mailbox ?? MAILBOX,
    from: over.from ?? 'stranger@unknown-shipper.test',
    fromName: over.fromName,
    to: [over.mailbox ?? MAILBOX],
    cc: [],
    subject: over.subject ?? `Rates please ${RUN}-${seq}`,
    body: over.body ?? 'Two 40HC Shanghai to Shuwaikh, ready 25 August.',
    receivedAt: new Date('2026-08-18T07:14:00Z'),
    inReplyTo: over.inReplyTo,
    references: over.references ?? [],
    attachments: over.attachments ?? [],
  }
}

/** A source that yields a fixed list, as an IMAP poll would. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sourceOf = (...list: any[]) => [
  {
    key: 'fixture',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async collect(handler: (m: any) => Promise<void>): Promise<number> {
      for (const m of list) await handler(m)
      return list.length
    },
  },
]

const messagesOn = (enquiryId: string) =>
  withActor(sys, (tx) => tx.select().from(messages).where(eq(messages.enquiryId, enquiryId)))

const enquiriesFromRun = () =>
  withActor(sys, (tx) =>
    tx.select().from(enquiries).where(eq(enquiries.branchId, BRANCH)),
  )

/**
 * The enquiry this case just caused, found by the subject it was filed under.
 *
 * Fails here rather than returning undefined, so a case that stopped creating
 * enquiries reports *that* instead of a null dereference three lines later.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enquiryNoted(notes: string): Promise<any> {
  const found = (await enquiriesFromRun()).find((e: { notes: string | null }) => e.notes === notes)
  expect(found, `no enquiry filed under "${notes}"`).toBeTruthy()
  return found
}

describe.skipIf(!enabled)('inbound mail against a database', () => {
  beforeAll(async () => {
    await withActor(sys, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'inbound-mail-fixture@qabandi.test',
          nameEn: 'Inbound Mail Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'IMB',
          legalNameEn: 'Inbound Mail Branch',
          legalNameAr: 'فرع البريد الوارد',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'IMB',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-INBOUND-MAIL',
          legalNameEn: 'Inbound Mail Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      await tx
        .insert(customerContacts)
        .values({
          customerId: CUSTOMER,
          nameEn: 'Fatima Al-Rashid',
          email: 'fatima@known-shipper.test',
          isPrimary: true,
        })
        .onConflictDoNothing()

      /*
        The mailbox row is the branch mapping now.

        `resolveBranches` joins `mailboxes` to `branches` on the username the
        adapter stamps onto each message, so without this row every fixture
        message is an orphan — which is exactly what `ORPHAN_MAILBOX` below
        relies on, and why only one of the two addresses gets a row.
      */
      await tx
        .insert(mailboxes)
        .values({
          branchId: BRANCH,
          host: 'imap.invalid',
          username: MAILBOX,
          passwordSealed: sealSecret('fixture-password'),
        })
        .onConflictDoNothing()
    })
  })

  afterAll(async () => {
    // Nothing is deleted (§5.5); the fixtures are closed so no SLA sweep or
    // board query picks them up afterwards.
    if (!enabled) return
    await withActor(sys, async (tx) => {
      await tx
        .update(enquiries)
        .set({ status: 'cancelled', closedAt: new Date() })
        .where(eq(enquiries.branchId, BRANCH))

      /*
        The outbox rows are marked dispatched, and this is not tidiness.

        `expand()` in the dispatcher selects *every* undispatched row across
        every branch — it is a queue, not a per-branch view — so an
        `enquiry.created` left pending here becomes work for `notification-
        dispatch.test.ts` when it runs next, and for the real dispatcher on
        any machine this suite is pointed at. Left alone it timed that suite
        out at thirty seconds, which is a fixture leak diagnosed as a flake.
      */
      await tx
        .update(notificationOutbox)
        .set({ dispatchedAt: new Date() })
        .where(eq(notificationOutbox.branchId, BRANCH))

      // Deactivated rather than deleted (§5.5), and so a real poll on this
      // database never tries to reach `imap.invalid`.
      await tx
        .update(mailboxes)
        .set({ isActive: false })
        .where(eq(mailboxes.branchId, BRANCH))
    })
  })

  it('turns a cold email from an unknown sender into an enquiry', async () => {
    const before = (await enquiriesFromRun()).length

    const result = await runInboundMailPoll(
      new Date('2026-08-18T07:20:00Z'),
      sourceOf(mail({ subject: `RFQ 2x40HC ${RUN}`, from: 'stranger@unknown-shipper.test' })),
    )

    expect(result.created).toBe(1)
    expect(result.threaded).toBe(0)
    expect(result.failed).toBe(0)

    const after = await enquiriesFromRun()
    expect(after.length).toBe(before + 1)

    const created = await enquiryNoted(`RFQ 2x40HC ${RUN}`)
    expect(created.channel).toBe('email')
    expect(created.status).toBe('new')
    // Unknown sender: a lead with a contact, not a rejection — FR-EQ-02.
    expect(created.customerId).toBeNull()
    expect(created.contactEmail).toBe('stranger@unknown-shipper.test')
    // The clock is the point of the intake: one queue, one owner, one clock.
    expect(created.slaStartedAt).toBeTruthy()
    expect(created.slaDueAt).toBeTruthy()
    expect(created.reference).toMatch(/^IMB-ENQ-\d{4}-\d{5}$/)
  })

  it('keeps the body as a message on the thread, not as the enquiry', async () => {
    const body = `Please quote. Ref ${RUN} internal.`
    await runInboundMailPoll(
      new Date('2026-08-18T07:21:00Z'),
      sourceOf(mail({ subject: `Body test ${RUN}`, body })),
    )

    const enquiry = await enquiryNoted(`Body test ${RUN}`)
    const thread = await messagesOn(enquiry.id)

    expect(thread).toHaveLength(1)
    expect(thread[0]!.body).toBe(body)
    expect(thread[0]!.direction).toBe('inbound')
    expect(thread[0]!.channel).toBe('email')
  })

  /**
   * The bug this is here to catch.
   *
   * A poll that ran twice over a mailbox whose flags did not stick — or a
   * provider redelivering — would otherwise open a second enquiry for the same
   * mail every minute. The unique key on `(provider, external_id)` is what
   * refuses it, and this proves the worker actually leans on it.
   */
  it('refuses the same message twice', async () => {
    const twice = mail({ subject: `Duplicate ${RUN}` })

    const first = await runInboundMailPoll(new Date('2026-08-18T07:22:00Z'), sourceOf(twice))
    const second = await runInboundMailPoll(new Date('2026-08-18T07:23:00Z'), sourceOf(twice))

    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(second.duplicates).toBe(1)

    const matching = (await enquiriesFromRun()).filter(
      (e: { notes: string | null }) => e.notes === `Duplicate ${RUN}`,
    )
    expect(matching).toHaveLength(1)
  })

  it('threads a reply onto the enquiry it quotes instead of opening another', async () => {
    await runInboundMailPoll(
      new Date('2026-08-18T07:24:00Z'),
      sourceOf(mail({ subject: `Thread me ${RUN}` })),
    )

    const enquiry = await enquiryNoted(`Thread me ${RUN}`)

    const before = (await enquiriesFromRun()).length

    const result = await runInboundMailPoll(
      new Date('2026-08-18T07:25:00Z'),
      sourceOf(mail({ subject: `Re: ${enquiry.reference} — confirmed`, body: 'Go ahead.' })),
    )

    expect(result.threaded).toBe(1)
    expect(result.created).toBe(0)
    expect((await enquiriesFromRun()).length).toBe(before)

    const thread = await messagesOn(enquiry.id)
    expect(thread).toHaveLength(2)
    expect(thread.some((m: { body: string }) => m.body === 'Go ahead.')).toBe(true)
  })

  it('attributes a known contact to their customer', async () => {
    await runInboundMailPoll(
      new Date('2026-08-18T07:26:00Z'),
      sourceOf(mail({ subject: `Known sender ${RUN}`, from: 'fatima@known-shipper.test' })),
    )

    const enquiry = await enquiryNoted(`Known sender ${RUN}`)
    expect(enquiry.customerId).toBe(CUSTOMER)
  })

  /**
   * A disclosure boundary, and the reason it is narrower than it looks.
   *
   * `matchCustomer` identifies the *sender*, not the owner of the thread. A
   * mail from one customer's contact quoting another customer's job reference
   * resolves a customer and a target that disagree — so visibility is granted
   * only on the enquiry the mail itself just opened, where the two cannot
   * disagree. Everything threaded starts staff-only and is shared by a person.
   */
  it('shows the customer their own new enquiry and keeps replies staff-only', async () => {
    await runInboundMailPoll(
      new Date('2026-08-18T07:31:00Z'),
      sourceOf(mail({ subject: `Visible ${RUN}`, from: 'fatima@known-shipper.test' })),
    )

    const enquiry = await enquiryNoted(`Visible ${RUN}`)
    const [opening] = await messagesOn(enquiry.id)
    expect(opening!.customerVisible).toBe(true)

    await runInboundMailPoll(
      new Date('2026-08-18T07:32:00Z'),
      sourceOf(
        mail({ subject: `Re: ${enquiry.reference}`, from: 'fatima@known-shipper.test', body: 'Any news?' }),
      ),
    )

    const thread = await messagesOn(enquiry.id)
    const reply = thread.find((m: { body: string }) => m.body === 'Any news?')
    expect(reply).toBeTruthy()
    expect(reply!.customerVisible).toBe(false)
  })

  it('raises the enquiry.created notification in the same breath', async () => {
    await runInboundMailPoll(
      new Date('2026-08-18T07:27:00Z'),
      sourceOf(mail({ subject: `Notify ${RUN}` })),
    )

    const enquiry = await enquiryNoted(`Notify ${RUN}`)

    const [event] = await withActor(sys, (tx) =>
      tx
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.enquiryId, enquiry.id))
        .limit(1),
    )

    expect(event).toBeTruthy()
    expect(event!.eventKey).toBe('enquiry.created')
  })

  it('preserves an attachment as an asset on the message', async () => {
    const packingList = Buffer.from('PACKING LIST\n2 pallets\n', 'utf8')

    await runInboundMailPoll(
      new Date('2026-08-18T07:28:00Z'),
      sourceOf(
        mail({
          subject: `With docs ${RUN}`,
          attachments: [
            { filename: 'packing-list.pdf', contentType: 'application/pdf', content: packingList },
          ],
        }),
      ),
    )

    const enquiry = await enquiryNoted(`With docs ${RUN}`)
    const thread = await messagesOn(enquiry.id)

    const links = await withActor(sys, (tx) =>
      tx.select().from(messageAttachments).where(eq(messageAttachments.messageId, thread[0]!.id)),
    )
    expect(links).toHaveLength(1)

    const [asset] = await withActor(sys, (tx) =>
      tx.select().from(assets).where(eq(assets.id, links[0]!.assetId)).limit(1),
    )
    expect(asset).toBeTruthy()
    expect(asset!.fileName).toBe('packing-list.pdf')
    expect(asset!.contentType).toBe('application/pdf')
    expect(Number(asset!.byteSize)).toBe(packingList.byteLength)
    expect(asset!.branchId).toBe(BRANCH)
  })

  /**
   * A message whose mailbox has no active row has no branch to be filed under
   * — the row that carried the mapping was deactivated, or never existed. The
   * run records the failure and moves on; the mail is never flagged, so it is
   * still there when somebody puts the row back.
   */
  it('fails a message from a mailbox with no active row, without losing the mail', async () => {
    const result = await runInboundMailPoll(
      new Date('2026-08-18T07:29:00Z'),
      sourceOf(mail({ mailbox: ORPHAN_MAILBOX, subject: `Orphan ${RUN}` })),
    )

    expect(result.failed).toBe(1)
    expect(result.created).toBe(0)

    const orphaned = (await enquiriesFromRun()).filter(
      (e: { notes: string | null }) => e.notes === `Orphan ${RUN}`,
    )
    expect(orphaned).toHaveLength(0)
  })

  it('records what arrived on the receipt without the attachment bytes', async () => {
    const message = mail({
      subject: `Receipt ${RUN}`,
      attachments: [
        { filename: 'big.pdf', contentType: 'application/pdf', content: Buffer.alloc(4096, 0x41) },
      ],
    })

    await runInboundMailPoll(new Date('2026-08-18T07:30:00Z'), sourceOf(message))

    const [receipt] = await withActor(sys, (tx) =>
      tx
        .select()
        .from(inboundWebhookEvents)
        .where(eq(inboundWebhookEvents.externalId, message.externalId))
        .limit(1),
    )

    expect(receipt).toBeTruthy()
    expect(receipt!.processedAt).toBeTruthy()
    expect(receipt!.error).toBeNull()

    // The envelope, and only the envelope — `payload` is an idempotency
    // record, not a document store.
    const payload = receipt!.payload as Record<string, unknown>
    expect(payload.subject).toBe(`Receipt ${RUN}`)
    expect(JSON.stringify(payload)).not.toContain('QUFB')
    expect((payload.attachments as { filename: string }[])[0]!.filename).toBe('big.pdf')
  })
})
