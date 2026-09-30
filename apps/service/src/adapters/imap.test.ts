/**
 * Normalising a received email.
 *
 * The IMAP conversation itself is `imapflow`'s and is not re-tested here. What
 * *is* ours is the step after it: turning whatever a sender's mail client
 * produced into the one shape `inbound-mail.ts` reasons about. Every case
 * below is a real thing that arrives at a freight desk, written as the bytes
 * that actually come down the wire rather than as an object a mock handed
 * over — the same argument `smtp.test.ts` makes for speaking to a socket.
 *
 * The parse is `mailparser`'s and the fixtures are RFC 822, so a case that
 * passes here passes against the real thing.
 */

import { describe, expect, it } from 'vitest'
import { simpleParser } from 'mailparser'
import { eachIsolated, flattenHtml, toInboundMessage } from './imap'

const MAILBOX = 'kuwait@qabandi.com'
const BIG = 25 * 1024 * 1024

async function normalise(raw: string, maxBytes = BIG) {
  return toInboundMessage(await simpleParser(Buffer.from(raw, 'utf8')), MAILBOX, maxBytes)
}

// --- HTML flattening ---------------------------------------------------------

describe('flattenHtml', () => {
  it('turns block structure into line breaks', () => {
    expect(flattenHtml('<p>Two 40HC</p><p>Shanghai to Shuwaikh</p>')).toBe(
      'Two 40HC\nShanghai to Shuwaikh',
    )
  })

  /**
   * The bug this is here to catch.
   *
   * Outlook wraps every message in several kilobytes of `mso-` declarations
   * inside a `<style>` block. Stripping tags alone leaves the *contents* of
   * that block behind as body text, so a two-line enquiry arrives on the board
   * as four hundred lines of CSS with the request somewhere near the bottom.
   */
  it('drops the contents of style and script, not just their tags', () => {
    const outlook =
      '<html><head><style>p.MsoNormal {mso-style-parent:"";margin:0cm}</style></head>' +
      '<body><p class=MsoNormal>Please quote 2x40HC</p></body></html>'
    const flat = flattenHtml(outlook)
    expect(flat).toBe('Please quote 2x40HC')
    expect(flat).not.toContain('mso-style-parent')
  })

  it('decodes the entities a mail client actually emits', () => {
    expect(flattenHtml('<p>Sea&nbsp;freight &amp; customs &lt;urgent&gt;</p>')).toBe(
      'Sea freight & customs <urgent>',
    )
  })

  it('leaves Arabic intact', () => {
    expect(flattenHtml('<p>مرحبا، نرجو تقديم عرض سعر</p>')).toBe('مرحبا، نرجو تقديم عرض سعر')
  })

  it('collapses the blank-line drifts of nested markup', () => {
    expect(flattenHtml('<div><p>A</p></div><br><br><br><div><p>B</p></div>')).toBe('A\n\nB')
  })
})

// --- the normalised message --------------------------------------------------

describe('toInboundMessage', () => {
  it('reads a plain enquiry into its parts', async () => {
    const message = await normalise(
      [
        'Message-ID: <c1@shipper.com.kw>',
        'From: Fatima Al-Rashid <fatima@shipper.com.kw>',
        'To: kuwait@qabandi.com',
        'Cc: ops@shipper.com.kw',
        'Subject: RFQ 2x40HC Shanghai to Shuwaikh',
        'Date: Tue, 18 Aug 2026 07:14:00 +0300',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        'Ready 25 August. Please quote.',
      ].join('\r\n'),
    )

    expect(message.externalId).toBe('<c1@shipper.com.kw>')
    expect(message.from).toBe('fatima@shipper.com.kw')
    expect(message.fromName).toBe('Fatima Al-Rashid')
    expect(message.to).toEqual(['kuwait@qabandi.com'])
    expect(message.cc).toEqual(['ops@shipper.com.kw'])
    expect(message.subject).toBe('RFQ 2x40HC Shanghai to Shuwaikh')
    expect(message.body).toBe('Ready 25 August. Please quote.')
    expect(message.mailbox).toBe(MAILBOX)
    expect(message.attachments).toHaveLength(0)
  })

  /**
   * Half this product's mail is Arabic (NFR-01), and a subject header is ASCII
   * by specification — so an Arabic subject arrives RFC 2047 encoded or not at
   * all. `smtp.ts` does the encoding on the way out; this is the same
   * requirement pointing the other way, and getting it wrong shows up as
   * mojibake on the enquiry board rather than as an error.
   */
  it('decodes an RFC 2047 Arabic subject and body', async () => {
    const subject = 'طلب عرض سعر'
    const encoded = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`

    const message = await normalise(
      [
        'Message-ID: <ar1@shipper.com.kw>',
        'From: =?UTF-8?B?2YHYp9i32YXYqQ==?= <fatima@shipper.com.kw>',
        'To: kuwait@qabandi.com',
        `Subject: ${encoded}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('نرجو تقديم عرض سعر للشحنة', 'utf8').toString('base64'),
      ].join('\r\n'),
    )

    expect(message.subject).toBe(subject)
    expect(message.fromName).toBe('فاطمة')
    expect(message.body).toBe('نرجو تقديم عرض سعر للشحنة')
  })

  /**
   * mailparser derives a text part from the HTML when the sender supplied
   * none, and its conversion is better than ours — so this asserts the
   * outcome that matters (readable text, no markup) rather than pinning the
   * exact whitespace of somebody else's converter. `flattenHtml` is the
   * fallback for the messages it leaves empty, and is tested directly above.
   */
  it('flattens an HTML-only message rather than storing markup', async () => {
    const message = await normalise(
      [
        'Message-ID: <h1@shipper.com.kw>',
        'From: ops@shipper.com.kw',
        'To: kuwait@qabandi.com',
        'Subject: Booking',
        'Content-Type: text/html; charset=UTF-8',
        '',
        '<html><body><p>Please book</p><p>2 x 40HC</p></body></html>',
      ].join('\r\n'),
    )

    expect(message.body).toContain('Please book')
    expect(message.body).toContain('2 x 40HC')
    expect(message.body).not.toContain('<')
  })

  it('keeps threading headers so a reply can find its job', async () => {
    const message = await normalise(
      [
        'Message-ID: <reply1@shipper.com.kw>',
        'In-Reply-To: <quote-9@qabandi.com>',
        'References: <enq-1@qabandi.com> <quote-9@qabandi.com>',
        'From: ops@shipper.com.kw',
        'To: kuwait@qabandi.com',
        'Subject: Re: KWI-ENQ-2026-00042',
        '',
        'Approved, please proceed.',
      ].join('\r\n'),
    )

    expect(message.inReplyTo).toBe('<quote-9@qabandi.com>')
    expect(message.references).toEqual(['<enq-1@qabandi.com>', '<quote-9@qabandi.com>'])
  })

  it('carries an attachment through with its bytes', async () => {
    const packingList = Buffer.from('PACKING LIST\n2 pallets\n', 'utf8')

    const message = await normalise(
      [
        'Message-ID: <a1@shipper.com.kw>',
        'From: ops@shipper.com.kw',
        'To: kuwait@qabandi.com',
        'Subject: Docs attached',
        'Content-Type: multipart/mixed; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        'Documents attached.',
        '--b1',
        'Content-Type: application/pdf; name="packing-list.pdf"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="packing-list.pdf"',
        '',
        packingList.toString('base64'),
        '--b1--',
        '',
      ].join('\r\n'),
    )

    expect(message.body).toBe('Documents attached.')
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments[0]!.filename).toBe('packing-list.pdf')
    expect(message.attachments[0]!.contentType).toBe('application/pdf')
    expect(message.attachments[0]!.content.toString('utf8')).toBe(packingList.toString('utf8'))
  })

  /**
   * The signature-block problem.
   *
   * Every corporate sender has a logo in their signature, carried as a `cid:`
   * part that mailparser flags `related`. Treating those as attachments puts
   * four PNGs on the enquiry of anyone with a letterhead, and buries the
   * packing list that actually matters underneath them.
   */
  it('ignores inline images referenced by the HTML', async () => {
    const message = await normalise(
      [
        'Message-ID: <sig1@shipper.com.kw>',
        'From: ops@shipper.com.kw',
        'To: kuwait@qabandi.com',
        'Subject: Quote please',
        'Content-Type: multipart/related; boundary="r1"',
        '',
        '--r1',
        'Content-Type: text/html; charset=UTF-8',
        '',
        '<p>Please quote</p><img src="cid:logo1">',
        '--r1',
        'Content-Type: image/png',
        'Content-Transfer-Encoding: base64',
        'Content-ID: <logo1>',
        'Content-Disposition: inline; filename="logo.png"',
        '',
        Buffer.from('not-really-a-png').toString('base64'),
        '--r1--',
        '',
      ].join('\r\n'),
    )

    expect(message.attachments).toHaveLength(0)
    expect(message.body).toBe('Please quote')
  })

  /**
   * An 80MB scan of a whole customs file is a real thing a customer sends. The
   * enquiry is worth more than the file, so the mail is accepted, the name is
   * kept, and the bytes are dropped — a coordinator can then ask for it
   * another way, which they cannot do if the message was refused outright.
   */
  it('keeps the name of an oversized attachment and drops its bytes', async () => {
    const message = await normalise(
      [
        'Message-ID: <big1@shipper.com.kw>',
        'From: ops@shipper.com.kw',
        'To: kuwait@qabandi.com',
        'Subject: Customs file',
        'Content-Type: multipart/mixed; boundary="b2"',
        '',
        '--b2',
        'Content-Type: text/plain',
        '',
        'Scan attached.',
        '--b2',
        'Content-Type: application/pdf; name="scan.pdf"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="scan.pdf"',
        '',
        Buffer.alloc(4096, 0x41).toString('base64'),
        '--b2--',
        '',
      ].join('\r\n'),
      1024,
    )

    expect(message.attachments).toHaveLength(1)
    expect(message.attachments[0]!.filename).toBe('scan.pdf')
    expect(message.attachments[0]!.content.byteLength).toBe(0)
  })

  /**
   * The bug this is here to catch.
   *
   * `externalId` is the idempotency key. Scanner-to-email appliances and some
   * web forms send without a `Message-ID`, so a random substitute would make
   * the same message a brand new enquiry on every poll — one a minute, for
   * ever, until somebody noticed the board filling with the same mail.
   */
  it('synthesises a stable id when the sender omitted Message-ID', async () => {
    const raw = [
      'From: scanner@shipper.com.kw',
      'To: kuwait@qabandi.com',
      'Subject: Scan 0042',
      'Date: Tue, 18 Aug 2026 07:14:00 +0300',
      '',
      'Scanned document.',
    ].join('\r\n')

    const first = await normalise(raw)
    const second = await normalise(raw)

    expect(first.externalId).toMatch(/^synthetic-[0-9a-f]{32}@qabandi$/)
    expect(second.externalId).toBe(first.externalId)
  })

  it('gives a different id to a different message from the same sender', async () => {
    const of = (subject: string): string =>
      [
        'From: scanner@shipper.com.kw',
        'To: kuwait@qabandi.com',
        `Subject: ${subject}`,
        'Date: Tue, 18 Aug 2026 07:14:00 +0300',
        '',
        `Body for ${subject}`,
      ].join('\r\n')

    const a = await normalise(of('Scan 0042'))
    const b = await normalise(of('Scan 0043'))

    expect(a.externalId).not.toBe(b.externalId)
  })

  it('survives a message with no body at all', async () => {
    const message = await normalise(
      [
        'Message-ID: <empty1@shipper.com.kw>',
        'From: ops@shipper.com.kw',
        'To: kuwait@qabandi.com',
        'Subject: (no body)',
        '',
        '',
      ].join('\r\n'),
    )

    expect(message.body).toBe('')
    expect(message.subject).toBe('(no body)')
  })
})

// --- bounces of our own mail -------------------------------------------------

/**
 * A bounce, read back to the message of ours it reports — FR-NT-06.
 *
 * The dispatcher stores the `Message-ID` `sendMail` minted; a bounce quotes
 * it in the original it attaches. These fixtures are the shapes MTAs actually
 * send, because the failure this guards against is the quiet one: a delay
 * warning or an out-of-office read as a bounce would mark a delivery `failed`
 * that in fact arrived.
 */
describe('bounceOf', () => {
  const OURS = '<5f0c9a3e-1111-4222-8333-944455556666@qabandi.com>'

  const dsn = (
    action: string,
    original: { type: string; headers: string[] } = {
      type: 'message/rfc822',
      headers: [`Message-ID: ${OURS}`, 'Auto-Submitted: auto-generated'],
    },
  ): string =>
    [
      'Return-Path: <>',
      'From: MAILER-DAEMON@mail.example.net (Mail Delivery System)',
      'To: kuwait@qabandi.com',
      `Subject: ${action === 'failed' ? 'Undelivered Mail Returned to Sender' : 'Delayed Mail (still being retried)'}`,
      'Message-ID: <20260930100000.AB12@mail.example.net>',
      'Date: Tue, 30 Sep 2026 10:00:00 +0000',
      'Auto-Submitted: auto-replied',
      'MIME-Version: 1.0',
      'Content-Type: multipart/report; report-type=delivery-status; boundary="B1"',
      '',
      '--B1',
      'Content-Type: text/plain; charset=us-ascii',
      '',
      'This is the mail system at host mail.example.net.',
      '',
      '--B1',
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns; mail.example.net',
      '',
      'Final-Recipient: rfc822; nobody@customer.test',
      `Action: ${action}`,
      'Status: 5.1.1',
      'Diagnostic-Code: smtp; 550 5.1.1 <nobody@customer.test>: Recipient address',
      '    rejected: User unknown',
      '',
      '--B1',
      `Content-Type: ${original.type}`,
      '',
      'From: kuwait@qabandi.com',
      'To: nobody@customer.test',
      'Subject: Your enquiry was received',
      ...original.headers,
      '',
      'Thank you.',
      '--B1--',
      '',
    ].join('\r\n')

  it('reads the original Message-ID and the remote reason from a DSN', async () => {
    const message = await normalise(dsn('failed'))

    expect(message.automatic).toBe(true)
    expect(message.bounceOf).toEqual({
      messageId: OURS,
      reason: '550 5.1.1 <nobody@customer.test>: Recipient address rejected: User unknown',
    })
    // Its own id is not the one it reports on.
    expect(message.externalId).not.toBe(OURS)
  })

  it('reads the original from headers-only attachments too', async () => {
    const message = await normalise(
      dsn('failed', { type: 'text/rfc822-headers', headers: [`Message-ID: ${OURS}`] }),
    )
    expect(message.bounceOf?.messageId).toBe(OURS)
  })

  /**
   * The case that must not be a bounce. A delay DSN quotes the original
   * exactly as a failure does, and the mail usually arrives an hour later.
   */
  it('does not call a delay a failure', async () => {
    const message = await normalise(dsn('delayed'))
    expect(message.automatic).toBe(true)
    expect(message.bounceOf).toBeUndefined()
  })

  it('reads a mail daemon’s plain-text letter, the original quoted inline', async () => {
    const message = await normalise(
      [
        'From: MAILER-DAEMON@mx.example.org',
        'To: kuwait@qabandi.com',
        'Subject: failure notice',
        'Message-ID: <qmail-1@mx.example.org>',
        '',
        'Hi. This is the qmail-send program at mx.example.org.',
        "I'm afraid I wasn't able to deliver your message to the following addresses.",
        '',
        '<nobody@customer.test>:',
        '552 5.2.2 Mailbox full',
        '',
        '--- Below this line is a copy of the message.',
        '',
        'From: kuwait@qabandi.com',
        `Message-ID: ${OURS}`,
        'Subject: Invoice issued',
        '',
      ].join('\r\n'),
    )

    expect(message.bounceOf).toEqual({ messageId: OURS, reason: '552 5.2.2 Mailbox full' })
  })

  /** An out-of-office answers our message too — and is not a delivery failure. */
  it('is not fooled by an auto-reply that threads onto our message', async () => {
    const message = await normalise(
      [
        'From: fatima@shipper.com.kw',
        'To: kuwait@qabandi.com',
        'Subject: Automatic reply: Your enquiry was received',
        'Message-ID: <oof-1@shipper.com.kw>',
        `In-Reply-To: ${OURS}`,
        `References: ${OURS}`,
        'Auto-Submitted: auto-replied',
        '',
        'I am out of the office until Sunday.',
      ].join('\r\n'),
    )

    expect(message.automatic).toBe(true)
    expect(message.bounceOf).toBeUndefined()
  })

  it('is absent on an ordinary enquiry', async () => {
    const message = await normalise(
      [
        'From: fatima@shipper.com.kw',
        'To: kuwait@qabandi.com',
        'Subject: RFQ 2x40HC',
        'Message-ID: <rfq-1@shipper.com.kw>',
        '',
        'Please quote.',
      ].join('\r\n'),
    )
    expect(message.bounceOf).toBeUndefined()
  })
})

// --- one message's failure ---------------------------------------------------

/**
 * The loop `collect` runs — F56.
 *
 * A PDF that could not be stored used to end the poll; it stayed unread, was
 * first in line again a minute later, and every mail behind it waited. The
 * rule is that a throw costs that message and no other.
 */
describe('eachIsolated', () => {
  it('carries on past a failure and reports it', async () => {
    const acknowledged: string[] = []

    const outcome = await eachIsolated(['stuck', 'behind', 'after'], async (id) => {
      if (id === 'stuck') throw new Error('<stuck@x>: Object storage is not configured')
      acknowledged.push(id)
    })

    expect(acknowledged).toEqual(['behind', 'after'])
    expect(outcome).toEqual({
      handled: 2,
      failures: ['<stuck@x>: Object storage is not configured'],
    })
  })

  it('reports nothing when nothing failed', async () => {
    expect(await eachIsolated([1, 2], async () => {})).toEqual({ handled: 2, failures: [] })
  })
})
