/**
 * Which side of the trade wrote a message on an enquiry's thread (NEW-1).
 *
 * The rule leans towards refusing: a message is the customer's only when
 * nothing ties it to a partner, a colleague or the office. Each case below is
 * one of the ties.
 */

import { describe, expect, it } from 'vitest'
import {
  identifyingDomain,
  notCustomerAddress,
  rfqTokenIn,
  samePhone,
  threadSide,
  type ThreadMessageFacts,
  type ThreadParties,
} from '../src/thread-sides'

const SYSTEM = 'system'
const parties: ThreadParties = {
  partners: [{ partnerId: 'shaco', email: 'ops@shaco-agent.test', phone: '+86 21 5555 0199' }],
  staff: [{ email: 'noura@qabandi.test', phone: '6555 0100' }],
  ownAddresses: ['freight@qabandi.test', '1181979928328532'],
  otherCustomers: [{ email: 'buyer@other-customer.test', phone: null }],
}

const inbound = (over: Partial<ThreadMessageFacts>): ThreadMessageFacts => ({
  direction: 'inbound',
  fromAddress: 'buyer@customer.test',
  subject: null,
  body: 'Please quote',
  authorId: null,
  staffAuthored: false,
  partnerId: null,
  rateRequestPartnerId: null,
  ...over,
})

describe('the side a message is on', () => {
  it('is the customer when nothing says otherwise', () => {
    expect(threadSide(inbound({}), parties, SYSTEM).side).toBe('customer')
  })

  it('is the partner for a rate reply, even from an address we have never seen', () => {
    expect(
      threadSide(
        inbound({ rateRequestPartnerId: 'shaco', fromAddress: 'x@y.test' }),
        parties,
        SYSTEM,
      ),
    ).toEqual({ side: 'partner', partnerId: 'shaco' })
  })

  it('is the partner for a message carrying our RFQ tag, named when the token resolves', () => {
    const tagged = inbound({ subject: 'Re: Rate request [RFQ:abcdef012345] lane' })
    expect(threadSide(tagged, parties, SYSTEM)).toEqual({ side: 'partner', partnerId: null })
    expect(threadSide(tagged, parties, SYSTEM, () => 'shaco')).toEqual({
      side: 'partner',
      partnerId: 'shaco',
    })
  })

  it('is the partner by contact address, corporate domain, or phone', () => {
    for (const fromAddress of [
      'OPS@shaco-agent.test',
      'pricing@shaco-agent.test',
      '862155550199',
    ]) {
      expect(threadSide(inbound({ fromAddress }), parties, SYSTEM), fromAddress).toEqual({
        side: 'partner',
        partnerId: 'shaco',
      })
    }
  })

  it('is staff for a colleague, our own mailbox, or a message marked as staff', () => {
    expect(threadSide(inbound({ fromAddress: 'noura@qabandi.test' }), parties, SYSTEM).side).toBe(
      'staff',
    )
    expect(threadSide(inbound({ fromAddress: 'freight@qabandi.test' }), parties, SYSTEM).side).toBe(
      'staff',
    )
    expect(threadSide(inbound({ staffAuthored: true }), parties, SYSTEM).side).toBe('staff')
  })

  it('reads outbound as the agent or a person', () => {
    const out = { ...inbound({}), direction: 'outbound' as const }
    expect(threadSide({ ...out, authorId: SYSTEM }, parties, SYSTEM).side).toBe('agent')
    expect(threadSide(out, parties, SYSTEM).side).toBe('agent')
    expect(threadSide({ ...out, authorId: 'fatima' }, parties, SYSTEM).side).toBe('staff')
  })
})

describe('an address a customer reply may never go to', () => {
  it('refuses partners, staff, the office and other customers', () => {
    expect(notCustomerAddress('pricing@shaco-agent.test', parties)).toBe('partner')
    expect(notCustomerAddress('+965 6555 0100', parties)).toBe('staff')
    expect(notCustomerAddress('FREIGHT@qabandi.test', parties)).toBe('own')
    expect(notCustomerAddress('buyer@other-customer.test', parties)).toBe('other_customer')
    expect(notCustomerAddress('  ', parties)).toBe('empty')
  })

  it('lets the customer through, including a Gmail sender when a partner uses Gmail', () => {
    const gmailPartner: ThreadParties = {
      ...parties,
      partners: [{ partnerId: 'p', email: 'agent@gmail.com', phone: null }],
    }
    expect(notCustomerAddress('buyer@customer.test', parties)).toBeNull()
    expect(notCustomerAddress('someone@gmail.com', gmailPartner)).toBeNull()
    expect(notCustomerAddress('agent@gmail.com', gmailPartner)).toBe('partner')
  })
})

describe('the helpers', () => {
  it('matches a national number to its E.164 form, and nothing shorter than seven digits', () => {
    expect(samePhone('2220 1234', '96522201234')).toBe(true)
    expect(samePhone('0096522201234', '+965 2220 1234')).toBe(true)
    expect(samePhone('123', '123')).toBe(false)
    expect(samePhone('22201234', '22201235')).toBe(false)
  })

  it('never identifies by a shared provider', () => {
    expect(identifyingDomain('a@gmail.com')).toBeNull()
    expect(identifyingDomain('a@Shipper.com.kw')).toBe('shipper.com.kw')
  })

  it('reads the RFQ tag from the subject, then the body', () => {
    expect(rfqTokenIn('Re: [RFQ:abcdef012345]', '')).toBe('abcdef012345')
    expect(rfqTokenIn('Fwd', 'see [RFQ:abcdef012345]')).toBe('abcdef012345')
    expect(rfqTokenIn('Quote please', 'no tag')).toBeNull()
  })
})
