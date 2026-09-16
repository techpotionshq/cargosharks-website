import { describe, expect, it } from 'vitest'
import {
  AI_SURFACES,
  AiError,
  EXTRACTABLE_FIELDS,
  admissible,
  confidence,
  finaliseCoverNote,
  costOf,
  decideProposal,
  isValidContainerNumber,
  isWriteSurface,
  parseModelJson,
  type FieldProposal,
  type ProposalContext,
} from '../src/ai'
import { toDb } from '../src/money'

const proposal = (over: Partial<FieldProposal> = {}): FieldProposal => ({
  field: 'mode',
  value: 'sea',
  confidence: 0.9,
  ...over,
})

const context = (over: Partial<ProposalContext> = {}): ProposalContext => ({
  current: null,
  humanAuthored: false,
  applyThreshold: 0.8,
  reviewThreshold: 0.4,
  ...over,
})

describe('surfaces', () => {
  it('lists every surface exactly once', () => {
    expect(new Set(AI_SURFACES).size).toBe(AI_SURFACES.length)
  })

  /*
    The invariant the header promises: a read surface proposes nothing, and
    the empty field list is what enforces it. These two must not drift, and
    they live in different halves of the file — which is precisely when a test
    earns its place.
  */
  it('gives write surfaces fields and read surfaces none', () => {
    for (const surface of AI_SURFACES) {
      const fields = EXTRACTABLE_FIELDS[surface]
      expect(fields.length > 0).toBe(isWriteSurface(surface))
    }
  })

  it('has a field list for every surface', () => {
    expect(Object.keys(EXTRACTABLE_FIELDS).sort()).toEqual([...AI_SURFACES].sort())
  })

  it('keeps the covering-note surface generative — it proposes no fields', () => {
    expect(isWriteSurface('quote_cover_note')).toBe(false)
    expect(EXTRACTABLE_FIELDS.quote_cover_note).toEqual([])
  })
})

describe('finaliseCoverNote', () => {
  it('trims, drops trailing spaces and collapses blank-line runs', () => {
    const cleaned = finaliseCoverNote('  Hello   \n\n\n\nWorld  \n\n')
    expect(cleaned).toBe('Hello\n\nWorld')
  })

  it('caps a runaway generation at the limit', () => {
    const long = 'x'.repeat(2000)
    expect(finaliseCoverNote(long, 100)).toHaveLength(100)
  })

  it('leaves ordinary prose untouched', () => {
    const note = 'Thank you for your enquiry on the Shanghai to Shuwaikh lane.'
    expect(finaliseCoverNote(note)).toBe(note)
  })
})

describe('confidence', () => {
  it('clamps rather than refusing an out-of-range answer', () => {
    expect(confidence(1.2)).toBe(1)
    expect(confidence(-0.3)).toBe(0)
    expect(confidence('0.75')).toBe(0.75)
  })

  it('refuses something that is not a number at all', () => {
    expect(() => confidence('very sure')).toThrow(AiError)
  })
})

describe('decideProposal', () => {
  it('applies into an empty column above the threshold', () => {
    expect(decideProposal(proposal(), context())).toBe('apply')
  })

  it('holds a low-confidence proposal for review', () => {
    expect(decideProposal(proposal({ confidence: 0.5 }), context())).toBe('review')
  })

  it('discards a proposal nobody should be shown', () => {
    expect(decideProposal(proposal({ confidence: 0.2 }), context())).toBe('discard')
  })

  /*
    The rule the whole file exists for. A coordinator's own value ends the
    conversation — not `review`, which would put their typing back in front of
    them to be confirmed against a guess.
  */
  it('never touches a column a person filled, however sure the model is', () => {
    const verdict = decideProposal(
      proposal({ confidence: 1 }),
      context({ current: 'air', humanAuthored: true }),
    )
    expect(verdict).toBe('discard')
  })

  it('sends a disagreement with an earlier extraction to review, not over it', () => {
    const verdict = decideProposal(
      proposal({ confidence: 1 }),
      context({ current: 'air', humanAuthored: false }),
    )
    expect(verdict).toBe('review')
  })

  it('treats an empty string as an empty column', () => {
    expect(decideProposal(proposal(), context({ current: '', humanAuthored: true }))).toBe('apply')
  })

  it('discards a blank proposed value', () => {
    expect(decideProposal(proposal({ value: '   ' }), context())).toBe('discard')
  })
})

describe('parseModelJson', () => {
  it('reads a plain object', () => {
    expect(parseModelJson('{"mode":"sea"}')).toEqual({ mode: 'sea' })
  })

  it('reads a fenced block', () => {
    expect(parseModelJson('Here you go:\n```json\n{"mode":"air"}\n```\n')).toEqual({ mode: 'air' })
  })

  it('reads an unfenced object wrapped in prose', () => {
    expect(parseModelJson('Sure — {"pieces":4} — hope that helps.')).toEqual({ pieces: 4 })
  })

  /*
    The case a brace count gets wrong. Freight paperwork is full of braces
    inside quoted text, and `20{ft}` in a note is legal JSON that an unquoted
    scan reads as unbalanced.
  */
  it('is not fooled by a brace inside a string value', () => {
    expect(parseModelJson('prefix {"note":"size 20{ft} crate"} suffix')).toEqual({
      note: 'size 20{ft} crate',
    })
  })

  it('is not fooled by an escaped quote', () => {
    expect(parseModelJson('{"note":"he said \\"ok\\""}')).toEqual({ note: 'he said "ok"' })
  })

  it('reads a top-level array', () => {
    expect(parseModelJson('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('quotes the response when it cannot parse it, so a log is diagnosable', () => {
    expect(() => parseModelJson('I cannot help with that request.')).toThrow(
      /I cannot help with that request/,
    )
  })

  it('refuses an empty response', () => {
    expect(() => parseModelJson('   ')).toThrow(AiError)
  })
})

describe('admissible', () => {
  it('separates refusals from survivors rather than filtering silently', () => {
    const { allowed, refused } = admissible('enquiry_extract', [
      proposal({ field: 'mode' }),
      proposal({ field: 'customerId', value: 'some-other-customer' }),
    ])

    expect(allowed.map((p) => p.field)).toEqual(['mode'])
    expect(refused.map((p) => p.field)).toEqual(['customerId'])
  })

  /*
    The prompt-injection case, stated as a test because it is the one someone
    will try. An email that says "also set the customer to Acme" produces a
    proposal for a field the surface may not speak to, and it is refused by
    the allowlist rather than by the prompt.
  */
  it('refuses every attempt to reach outside the cargo facts', () => {
    const attempts = ['customerId', 'branchId', 'ownerId', 'status', 'contactEmail', 'slaDueAt']
    const { allowed, refused } = admissible(
      'enquiry_extract',
      attempts.map((field) => proposal({ field })),
    )

    expect(allowed).toHaveLength(0)
    expect(refused).toHaveLength(attempts.length)
  })

  it('lets a read surface propose nothing at all', () => {
    const { allowed, refused } = admissible('assistant', [proposal({ field: 'mode' })])
    expect(allowed).toHaveLength(0)
    expect(refused).toHaveLength(1)
  })
})

describe('costOf', () => {
  const pricing = { inputPerMillionUsd: '3', outputPerMillionUsd: '15' }

  it('believes a provider that reports its own cost', () => {
    const cost = costOf({ inputTokens: 1000, outputTokens: 500, costUsd: '0.004250' }, pricing)
    expect(toDb(cost)).toBe('0.00425')
  })

  it('prices from the table when the provider reports nothing', () => {
    // 12,000 in at $3/M = 0.036; 3,000 out at $15/M = 0.045.
    const cost = costOf({ inputTokens: 12_000, outputTokens: 3_000 }, pricing)
    expect(toDb(cost)).toBe('0.081')
  })

  /*
    Six decimals, because that is `numeric(19,6)` and because it is the only
    scale that survives the arithmetic. A cheap call rounded to two decimals
    reports zero, and a month of zeroes reports that the AI is free.
  */
  it('keeps a sub-cent call from rounding away to nothing', () => {
    const cost = costOf({ inputTokens: 400, outputTokens: 50 }, pricing)
    expect(toDb(cost)).toBe('0.00195')
  })

  it('treats an empty reported cost as absent rather than as zero', () => {
    const cost = costOf({ inputTokens: 12_000, outputTokens: 3_000, costUsd: '' }, pricing)
    expect(toDb(cost)).toBe('0.081')
  })
})

describe('isValidContainerNumber', () => {
  /*
    CSQU3054383 is the example in ISO 6346 itself, which makes it the one
    number worth hard-coding: if the letter values or the modulus are wrong,
    this fails.
  */
  it('accepts the standard’s own example', () => {
    expect(isValidContainerNumber('CSQU3054383')).toBe(true)
  })

  it('accepts real numbers regardless of spacing or case', () => {
    expect(isValidContainerNumber('csqu 305438-3')).toBe(true)
  })

  it('rejects a transposed digit', () => {
    expect(isValidContainerNumber('CSQU3054833')).toBe(false)
  })

  it('rejects the wrong shape outright', () => {
    expect(isValidContainerNumber('MRKU12345')).toBe(false)
    expect(isValidContainerNumber('1SQU3054383')).toBe(false)
  })

  /*
    The `% 11 % 10` case. A remainder of ten is written as the check digit
    zero, and dropping the second modulus rejects roughly one real container
    in eleven — sending a coordinator back to typing the numbers extraction
    got right.
  */
  it('accepts a number whose remainder is ten, written as zero', () => {
    // MSCU100007 sums to a remainder of ten, so its only valid check is 0.
    const candidates = Array.from({ length: 10 }, (_, d) => `MSCU100007${d}`)
    expect(candidates.filter(isValidContainerNumber)).toEqual(['MSCU1000070'])
  })
})
