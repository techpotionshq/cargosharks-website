import { describe, expect, it } from 'vitest'
import {
  CREDIT_WARNING_RATIO,
  CurrencyMismatchError,
  assessCredit,
  findCoveringOverride,
  isNearLimit,
  money,
  outstandingFrom,
  overrideCovers,
  toDb,
  type CreditPosition,
} from '../src/index'

const kwd = (amount: string) => money(amount, 'KWD')

const position = (patch: Partial<CreditPosition> = {}): CreditPosition => ({
  outstanding: kwd('12000'),
  limit: kwd('40000'),
  onHold: false,
  ...patch,
})

describe('assessCredit', () => {
  it('lets a customer inside their limit through', () => {
    const result = assessCredit(position())
    expect(result.outcome).toBe('within_limit')
    expect(result.blocked).toBe(false)
    expect(toDb(result.headroom!)).toBe('28000')
  })

  it('counts the proposed shipment, because that is the question being asked', () => {
    // 12,000 owed against a 40,000 limit is comfortable. Booking a 30,000
    // shipment is not, and checking the balance alone would miss it entirely.
    const result = assessCredit(position(), kwd('30000'))
    expect(result.outcome).toBe('over_limit')
    expect(result.blocked).toBe(true)
    expect(toDb(result.excess)).toBe('2000')
  })

  it('treats a customer exactly on the limit as inside it', () => {
    // Blocking at equality turns every round-number limit into one fils less,
    // which nobody intends and everybody has to discover.
    const result = assessCredit(position({ outstanding: kwd('40000') }))
    expect(result.outcome).toBe('within_limit')
    expect(result.blocked).toBe(false)
  })

  it('blocks one fils over', () => {
    expect(assessCredit(position({ outstanding: kwd('40000.001') })).blocked).toBe(true)
  })

  it('does not block a customer with no limit set', () => {
    // Null is "nobody has decided", not zero. Treating it as zero blocks every
    // customer in the database on the morning the feature ships.
    const result = assessCredit(position({ limit: null }), kwd('500000'))
    expect(result.outcome).toBe('unlimited')
    expect(result.blocked).toBe(false)
    expect(result.headroom).toBeNull()
  })

  it('blocks a held customer regardless of the arithmetic', () => {
    const result = assessCredit(position({ outstanding: kwd('0'), onHold: true }))
    expect(result.outcome).toBe('on_hold')
    expect(result.blocked).toBe(true)
  })

  it('still reports the exposure on a held customer', () => {
    // "On hold, 0.000 KWD outstanding" reads as a system fault rather than a
    // credit decision, so the hold does not zero the figures.
    const result = assessCredit(position({ onHold: true }), kwd('3000'))
    expect(toDb(result.exposure)).toBe('15000')
    expect(toDb(result.headroom!)).toBe('25000')
  })

  it('refuses to compare two currencies rather than picking a rate', () => {
    // A rate chosen inside a decision function makes yesterday's decision move
    // when today's rate does.
    expect(() => assessCredit(position(), money('30000', 'USD'))).toThrow(CurrencyMismatchError)
    expect(() => assessCredit(position({ limit: money('40000', 'USD') }))).toThrow(
      CurrencyMismatchError,
    )
  })

  it('keeps three decimals on a Kuwaiti excess', () => {
    const result = assessCredit(position({ outstanding: kwd('40000') }), kwd('0.125'))
    expect(toDb(result.excess)).toBe('0.125')
  })
})

describe('isNearLimit', () => {
  it('warns at the threshold and not below it', () => {
    const at = assessCredit(position({ outstanding: kwd('32000') }))
    const below = assessCredit(position({ outstanding: kwd('31999') }))
    expect(CREDIT_WARNING_RATIO).toBe(0.8)
    expect(isNearLimit(at)).toBe(true)
    expect(isNearLimit(below)).toBe(false)
  })

  it('says nothing about a customer already blocked', () => {
    // The screen shows the block; a "nearly at the limit" badge beside it is
    // noise at best and contradictory at worst.
    expect(isNearLimit(assessCredit(position({ outstanding: kwd('50000') })))).toBe(false)
  })

  it('says nothing where there is no limit', () => {
    expect(isNearLimit(assessCredit(position({ limit: null })))).toBe(false)
  })

  it('does not divide by a zero limit', () => {
    const result = assessCredit(position({ outstanding: kwd('0'), limit: kwd('0') }))
    expect(isNearLimit(result)).toBe(false)
  })
})

describe('overrideCovers', () => {
  const today = '2026-08-19'

  it('covers the exact job it names and nothing else', () => {
    const o = { jobId: 'job-a', invoiceId: null, expiresOn: null }
    expect(overrideCovers(o, { jobId: 'job-a' }, today)).toBe(true)
    expect(overrideCovers(o, { jobId: 'job-b' }, today)).toBe(false)
  })

  it('does not let a one-shot become a permanent exemption', () => {
    // The failure this whole mechanism exists to prevent: the first override a
    // customer receives quietly authorising everything after it.
    const o = { jobId: 'job-a', invoiceId: null, expiresOn: null }
    expect(overrideCovers(o, {}, today)).toBe(false)
    expect(overrideCovers(o, { invoiceId: 'inv-1' }, today)).toBe(false)
  })

  it('covers everything for the customer while a standing override runs', () => {
    const o = { jobId: null, invoiceId: null, expiresOn: '2026-08-31' }
    expect(overrideCovers(o, { jobId: 'anything' }, today)).toBe(true)
  })

  it('covers the last day and not the day after', () => {
    const o = { jobId: null, invoiceId: null, expiresOn: '2026-08-19' }
    expect(overrideCovers(o, {}, '2026-08-19')).toBe(true)
    expect(overrideCovers(o, {}, '2026-08-20')).toBe(false)
  })

  it('returns which decision let it through, not merely that one did', () => {
    const overrides = [
      { jobId: 'job-z', invoiceId: null, expiresOn: null, id: 'first' },
      { jobId: 'job-a', invoiceId: null, expiresOn: null, id: 'second' },
    ]
    expect(findCoveringOverride(overrides, { jobId: 'job-a' }, today)?.id).toBe('second')
    expect(findCoveringOverride(overrides, { jobId: 'job-q' }, today)).toBeNull()
  })
})

describe('outstandingFrom', () => {
  it('nets what has been paid against what was invoiced', () => {
    const total = outstandingFrom(
      [
        { total: kwd('5000'), amountPaid: kwd('1000') },
        { total: kwd('3000'), amountPaid: kwd('3000') },
      ],
      'KWD',
    )
    expect(toDb(total)).toBe('4000')
  })

  it('nets a credit note off by ordinary addition', () => {
    // A credit note is an invoice with a negative total here, so it needs no
    // special case — which is the reason the definition lives in one function.
    const total = outstandingFrom(
      [
        { total: kwd('5000'), amountPaid: kwd('0') },
        { total: kwd('-1500'), amountPaid: kwd('0') },
      ],
      'KWD',
    )
    expect(toDb(total)).toBe('3500')
  })

  it('is zero, in the right currency, for a customer with no invoices', () => {
    expect(toDb(outstandingFrom([], 'KWD'))).toBe('0')
    expect(outstandingFrom([], 'KWD').currency).toBe('KWD')
  })
})
