import { describe, expect, it } from 'vitest'
import { rfqSubjectTag, rfqTokenIn } from './rfq-routing'

const TOKEN = 'a1b2c3d4e5f6a7b8'

describe('rfqSubjectTag / rfqTokenIn', () => {
  it('round-trips a token through a subject', () => {
    const subject = `Rate request ${rfqSubjectTag(TOKEN)} — Jebel Ali → Shuwaikh`
    expect(rfqTokenIn(subject, '')).toBe(TOKEN)
  })

  it('reads the token off a Re: reply subject', () => {
    expect(rfqTokenIn(`RE: Rate request [RFQ:${TOKEN}] — some lane`, '')).toBe(TOKEN)
  })

  it('falls back to the quoted body when a forward mangles the subject', () => {
    const body = ['Our rate is USD 950/40HC.', '', '> Rate request [RFQ:' + TOKEN + '] — lane'].join('\n')
    expect(rfqTokenIn('Fwd: rates', body)).toBe(TOKEN)
  })

  it('is null when no tag is present', () => {
    expect(rfqTokenIn('Just a normal enquiry', 'please quote Shanghai to Kuwait')).toBeNull()
    expect(rfqTokenIn(null, '')).toBeNull()
  })

  it('does not match a malformed tag', () => {
    // Too short, and with punctuation the token never contains.
    expect(rfqTokenIn('Rate request [RFQ:short] — lane', '')).toBeNull()
    expect(rfqTokenIn('Rate request [RFQ:has-a-dash-inside] — lane', '')).toBeNull()
  })
})
