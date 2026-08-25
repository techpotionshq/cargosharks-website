/**
 * The conventions that decide whether an exported file is safe to open.
 *
 * The formula guard is the case that matters. Everything else here is
 * formatting; that one is the difference between handing somebody a report and
 * handing them a payload, and the value being guarded came off an operator's
 * keyboard or out of an inbox.
 */

import { describe, expect, it } from 'vitest'
import { cell, csvDocument } from './csv'

describe('cell', () => {
  it('quotes every field, so a comma in a name is not a new column', () => {
    expect(cell('Al-Qabandi, W.L.L.')).toBe('"Al-Qabandi, W.L.L."')
  })

  it('doubles an embedded quote rather than ending the field', () => {
    expect(cell('the "fast" lane')).toBe('"the ""fast"" lane"')
  })

  /*
    Each of these four is executed on open by Excel and by Sheets. The
    apostrophe is invisible in the cell, so the guard costs the reader nothing.
  */
  it.each(['=cmd|calc', '+1+1', '-2+3', '@SUM(A1)'])('neutralises a formula: %s', (payload) => {
    expect(cell(payload)).toBe(`"'${payload}"`)
  })

  it('guards a tab and a carriage return, which lead the same parse', () => {
    expect(cell('\t=1')).toBe(`"'\t=1"`)
    expect(cell('\r=1')).toBe(`"'\r=1"`)
  })

  it('leaves an ordinary negative-looking reference alone once quoted', () => {
    // A leading digit is not a formula lead, so it is not prefixed.
    expect(cell('2026-08-25')).toBe('"2026-08-25"')
  })

  it('renders null and undefined as empty rather than as the words', () => {
    expect(cell(null)).toBe('""')
    expect(cell(undefined)).toBe('""')
  })

  it('carries a bigint without going through Number', () => {
    // Audit ids are bigint; `Number()` would round one past 2^53.
    expect(cell(9_007_199_254_740_993n)).toBe('"9007199254740993"')
  })
})

describe('csvDocument', () => {
  it('opens with a byte-order mark, so Excel reads Arabic as Arabic', () => {
    expect(csvDocument(['a'], [])).toMatch(/^﻿/)
  })

  it('ends every line with CRLF, including the last', () => {
    const doc = csvDocument(['a', 'b'], [['1', '2']])
    expect(doc.endsWith('\r\n')).toBe(true)
    expect(doc.split('\r\n').filter(Boolean)).toHaveLength(2)
  })

  it('quotes the trailer too, so a note cannot read as extra columns', () => {
    const doc = csvDocument(['a'], [['1']], 'TRUNCATED: stopped at 10,000 entries.')
    expect(doc.trimEnd().split('\r\n').at(-1)).toBe('"TRUNCATED: stopped at 10,000 entries."')
  })

  it('omits the trailer when there is none', () => {
    expect(
      csvDocument(['a'], [['1']])
        .trimEnd()
        .split('\r\n'),
    ).toHaveLength(2)
  })
})
