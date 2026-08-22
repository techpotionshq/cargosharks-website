/**
 * The enquiry reader's fixed vocabularies, and what it sends.
 *
 * Most of this worker needs a model and a database and is proven by running
 * it. Two things do not, and both are the kind of drift that stays silent:
 *
 *   - **the vocabularies the prompt names.** `transport_mode` and
 *     `trade_direction` are Postgres enums, so adding a mode is a migration —
 *     and the worker's own copy of the list would not follow it. A model told
 *     "mode is one of sea_fcl, sea_lcl, air, land, courier" the week after
 *     `rail` was added proposes nothing for rail enquiries, and nothing
 *     reports that. Pinned here against the enum the database actually holds.
 *
 *   - **what the mail looks like when it reaches the model.** The subject is
 *     included because it carries the shipment more often than any other line,
 *     and long bodies are cut so a forty-round reply chain does not cost a
 *     page of signature blocks to read.
 */

import { describe, expect, it } from 'vitest'
import { directionEnum, modeEnum } from '@qabandi/db'
import { DIRECTIONS, MODES, mailFor } from './enquiry-extract'

describe('the vocabularies the prompt is given', () => {
  it('names every transport mode the database allows, and no other', () => {
    expect([...MODES].sort()).toEqual([...modeEnum.enumValues].sort())
  })

  it('names every trade direction the database allows, and no other', () => {
    expect([...DIRECTIONS].sort()).toEqual([...directionEnum.enumValues].sort())
  })
})

describe('what the model is shown', () => {
  it('leads with the subject, because "RFQ 2x40HC Shanghai to Shuwaikh" is the enquiry', () => {
    const text = mailFor('RFQ 2x40HC Shanghai to Shuwaikh', 'Please quote.')
    expect(text.startsWith('Subject: RFQ 2x40HC Shanghai to Shuwaikh')).toBe(true)
    expect(text).toContain('Please quote.')
  })

  it('sends the body alone where there is no subject', () => {
    expect(mailFor(null, 'Please quote.')).toBe('Please quote.')
  })

  /** A reply chain is mostly quoted signatures; the enquiry is the top. */
  it('cuts a body long enough to be a reply chain, and says so', () => {
    const text = mailFor(null, 'x'.repeat(30_000))
    expect(text.length).toBeLessThan(30_000)
    expect(text.endsWith('[truncated]')).toBe(true)
  })

  it('leaves an ordinary body untouched', () => {
    const body = 'Two 40HC Shanghai to Shuwaikh, ready 25 August.'
    expect(mailFor(null, body)).toBe(body)
  })
})
