/**
 * The conversation panel folds the history a reply quotes, and keeps the words
 * the customer actually wrote in view. Each case is a mail client's shape.
 */

import { describe, expect, it } from 'vitest'
import { splitQuotedHistory } from '../src/correspondence'

describe('splitting a reply from the history it quotes', () => {
  it('leaves a message with no history alone', () => {
    expect(splitQuotedHistory('Two 40HC please.\n\nThanks')).toEqual({
      body: 'Two 40HC please.\n\nThanks',
      quoted: null,
    })
  })

  it('folds everything from an English attribution line down', () => {
    const split = splitQuotedHistory('Furniture.\n\nOn Tue, 1 Oct, Desk wrote:\n> Which goods?')
    expect(split.body).toBe('Furniture.')
    expect(split.quoted).toBe('On Tue, 1 Oct, Desk wrote:\n> Which goods?')
  })

  it('reads the Arabic attribution Gmail writes', () => {
    const split = splitQuotedHistory(
      'أثاث منزلي\n\nفي الثلاثاء، ١ أكتوبر، كتب المكتب:\n> ما البضاعة؟',
    )
    expect(split.body).toBe('أثاث منزلي')
    expect(split.quoted).toContain('ما البضاعة؟')
  })

  it('folds an Outlook original-message block', () => {
    const split = splitQuotedHistory('Yes 3\n-----Original Message-----\nFrom: desk@x.test\nHi')
    expect(split).toEqual({
      body: 'Yes 3',
      quoted: '-----Original Message-----\nFrom: desk@x.test\nHi',
    })
  })

  it('folds a trailing run of quoted lines with no attribution', () => {
    const split = splitQuotedHistory('Confirmed.\n\n> Can you confirm?\n>\n> Desk')
    expect(split.body).toBe('Confirmed.')
    expect(split.quoted).toBe('> Can you confirm?\n>\n> Desk')
  })

  it('keeps an inline answer whole, quote and all', () => {
    const text = '> Which port?\nShuwaikh.\n> How many?\nTwo.'
    expect(splitQuotedHistory(text)).toEqual({ body: text, quoted: null })
  })

  it('shows a message that is nothing but a quote rather than folding it to nothing', () => {
    expect(splitQuotedHistory('> forwarded line')).toEqual({
      body: '> forwarded line',
      quoted: null,
    })
  })
})
