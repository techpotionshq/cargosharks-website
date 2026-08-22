/**
 * Reading a provider's receipt — the half of `InboundMailSource` that had no
 * consumer at all until now.
 *
 * `toInboundMessage` is the only part of this worker worth pinning and it
 * needs no database, so these run everywhere. What they are protecting is
 * narrow and specific: the route answers `202 accepted` before any of this
 * happens, so every failure here is one the *provider* has already been told
 * did not occur. A wrong answer is not an error a sender sees — it is an
 * enquiry that silently never appears, or worse, one attributed to the wrong
 * mailbox and therefore the wrong branch.
 */

import { describe, expect, it } from 'vitest'
import { toInboundMessage } from './inbound-email-webhook'

const AT = new Date('2026-08-22T09:00:00Z')

const postmark = (over: Record<string, unknown> = {}) => ({
  From: 'Faisal Al-Rashid <shipper@customer.com>',
  FromName: 'Faisal Al-Rashid',
  To: 'freight@qabandi.test',
  ToFull: [{ Email: 'freight@qabandi.test', Name: 'Freight' }],
  CcFull: [{ Email: 'ops@customer.com', Name: 'Ops' }],
  Subject: 'RFQ 2x40HC Shanghai to Shuwaikh',
  MessageID: '<abc@mail.customer.com>',
  Date: 'Sat, 22 Aug 2026 09:14:00 +0300',
  TextBody: 'Two 40HC Shanghai to Shuwaikh, ready 15 September.',
  Headers: [
    { Name: 'In-Reply-To', Value: '<parent@mail.customer.com>' },
    { Name: 'References', Value: '<one@mail.test>  <two@mail.test>' },
  ],
  ...over,
})

const neutral = (over: Record<string, unknown> = {}) => ({
  messageId: '<xyz@mail.customer.com>',
  mailbox: 'freight@qabandi.test',
  from: 'shipper@customer.com',
  to: ['freight@qabandi.test'],
  subject: 'Airfreight quote',
  text: '240 cartons, 1,850 kg, Dubai to Kuwait.',
  ...over,
})

describe('reading a provider receipt', () => {
  describe('Postmark', () => {
    it('reads the envelope, the body and the threading headers', () => {
      const message = toInboundMessage(postmark(), AT)

      expect(message.externalId).toBe('<abc@mail.customer.com>')
      expect(message.from).toBe('shipper@customer.com')
      expect(message.fromName).toBe('Faisal Al-Rashid')
      expect(message.to).toEqual(['freight@qabandi.test'])
      expect(message.cc).toEqual(['ops@customer.com'])
      expect(message.subject).toBe('RFQ 2x40HC Shanghai to Shuwaikh')
      expect(message.body).toContain('Two 40HC')
      expect(message.inReplyTo).toBe('<parent@mail.customer.com>')
      expect(message.references).toEqual(['<one@mail.test>', '<two@mail.test>'])
      expect(message.receivedAt.toISOString()).toBe('2026-08-22T06:14:00.000Z')
    })

    /**
     * The delivered-to address decides the branch, not the typed one.
     *
     * `To` is what the sender wrote and `OriginalRecipient` is where the mail
     * actually landed. They differ exactly when it matters — an alias, a
     * forward, or a mail that reached us on Bcc — and matching a branch on the
     * sender's typing is how Dubai's mail is filed under Kuwait.
     */
    it('takes the mailbox from the delivered-to address, not the typed one', () => {
      const message = toInboundMessage(
        postmark({ OriginalRecipient: 'doha@qabandi.test', To: 'someone-else@elsewhere.test' }),
        AT,
      )
      expect(message.mailbox).toBe('doha@qabandi.test')
    })

    it('falls back to the recipient list where the provider omits it', () => {
      expect(toInboundMessage(postmark(), AT).mailbox).toBe('freight@qabandi.test')
    })

    it('decodes attachments into bytes', () => {
      const message = toInboundMessage(
        postmark({
          Attachments: [
            {
              Name: 'packing-list.pdf',
              ContentType: 'application/pdf',
              Content: Buffer.from('%PDF-1.7 fixture').toString('base64'),
            },
          ],
        }),
        AT,
      )

      expect(message.attachments).toHaveLength(1)
      expect(message.attachments[0]!.filename).toBe('packing-list.pdf')
      expect(message.attachments[0]!.content.toString()).toBe('%PDF-1.7 fixture')
    })

    /*
      `InboundMessage` says HTML is flattened by the adapter and never stored
      as HTML. A provider that sends only an HTML part must still produce an
      enquiry with words in it.
    */
    it('flattens an HTML-only mail rather than storing markup', () => {
      const message = toInboundMessage(
        postmark({
          TextBody: '',
          HtmlBody: '<div><style>p{}</style><p>Two 40HC</p><p>Shuwaikh &amp; Shanghai</p></div>',
        }),
        AT,
      )

      expect(message.body).not.toContain('<')
      expect(message.body).not.toContain('p{}')
      expect(message.body).toContain('Two 40HC')
      expect(message.body).toContain('Shuwaikh & Shanghai')
    })

    it('refuses a receipt that names no recipient', () => {
      expect(() =>
        toInboundMessage(postmark({ To: '', ToFull: [], OriginalRecipient: '' }), AT),
      ).toThrow(/no recipient/)
    })

    /**
     * The headers that mark a bounce or an auto-reply cross the port as a
     * flag, read here the same way the IMAP adapter reads them — so a bounce
     * arriving through a provider is refused by the same rule as one polled.
     */
    it('flags mail whose headers say a machine sent it', () => {
      const flagged = (Headers: { Name: string; Value: string }[]) =>
        toInboundMessage(postmark({ Headers }), AT).automatic

      expect(flagged([{ Name: 'Auto-Submitted', Value: 'auto-replied' }])).toBe(true)
      expect(flagged([{ Name: 'X-Auto-Response-Suppress', Value: 'All' }])).toBe(true)
      expect(flagged([{ Name: 'Precedence', Value: 'bulk' }])).toBe(true)
      expect(flagged([{ Name: 'Return-Path', Value: '<>' }])).toBe(true)
    })

    it('does not flag ordinary mail', () => {
      expect(toInboundMessage(postmark(), AT).automatic).toBe(false)
      expect(
        toInboundMessage(postmark({ Headers: [{ Name: 'Auto-Submitted', Value: 'no' }] }), AT)
          .automatic,
      ).toBe(false)
    })
  })

  describe('the neutral shape', () => {
    it('reads it', () => {
      const message = toInboundMessage(neutral(), AT)
      expect(message.externalId).toBe('<xyz@mail.customer.com>')
      expect(message.mailbox).toBe('freight@qabandi.test')
      expect(message.subject).toBe('Airfreight quote')
      expect(message.attachments).toEqual([])
    })

    it('defaults the received time to now rather than refusing the mail', () => {
      expect(toInboundMessage(neutral({ receivedAt: 'not a date' }), AT).receivedAt).toEqual(AT)
    })
  })

  /**
   * The `Message-ID` is the idempotency key, so its absence is refused.
   *
   * Without one, a provider's redelivery cannot be told apart from a second
   * mail — and a provider that retries is the ordinary case, not the rare one.
   * Refusing once is better than opening a fresh enquiry on every attempt.
   */
  it('refuses a receipt with no Message-ID rather than risking a duplicate enquiry', () => {
    expect(() => toInboundMessage(postmark({ MessageID: '' }), AT)).toThrow(/Message-ID/)
    expect(() => toInboundMessage(neutral({ messageId: '   ' }), AT)).toThrow(/Message-ID/)
  })

  /**
   * An unrecognised shape is refused with the keys it saw.
   *
   * Guessing at a provider we have never seen is how a customer's mail gets
   * filed under the wrong sender, and the receipt stays unprocessed with the
   * reason recorded — a row somebody can find — rather than becoming an
   * enquiry attributed to nobody, which is a row nobody questions.
   */
  it('refuses a shape it does not know, naming what it saw', () => {
    expect(() => toInboundMessage({ event: 'delivered', recipient: 'a@b.test' }, AT)).toThrow(
      /event, recipient/,
    )
  })
})
