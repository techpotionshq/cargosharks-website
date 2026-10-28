import { describe, expect, it } from 'vitest'
import { scrub } from '../scripts/blog/lib.mjs'

// The voice forbids em dashes and FAQ answers about "the article"; the model
// writes both anyway, so `scrub` takes them out after the fact.
describe('scrub', () => {
  it('turns a dash after a bold list label into a colon', () => {
    expect(scrub('- **Base freight** — the rate per box.')).toBe(
      '- **Base freight**: the rate per box.',
    )
    expect(scrub('1. **THC** – terminal fee')).toBe('1. **THC**: terminal fee')
  })

  it('turns other em dashes into commas and keeps ranges', () => {
    expect(scrub('Free days — usually 5–7 — vary.')).toBe('Free days, usually 5–7, vary.')
  })

  it('answers directly instead of quoting the article', () => {
    expect(scrub('Disputes arise. The article says to define free days first.')).toBe(
      'Disputes arise. Define free days first.',
    )
    expect(scrub('This post says that rates vary.')).toBe('Rates vary.')
  })

  it('uses the Arabic comma in Arabic text', () => {
    expect(scrub('وقت السماح — سبعة أيام')).toBe('وقت السماح، سبعة أيام')
  })
})
