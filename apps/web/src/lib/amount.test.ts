/** QA P3: "1,200.500" and Arabic digits were refused as "not a number". */

import { describe, expect, it } from 'vitest'
import { normaliseAmount } from './amount'

describe('normaliseAmount', () => {
  it('drops thousands separators that group in threes', () => {
    expect(normaliseAmount('1,200.500')).toBe('1200.500')
    expect(normaliseAmount('12,345,678')).toBe('12345678')
    expect(normaliseAmount('1 200.5')).toBe('1200.5')
    expect(normaliseAmount('-4,350.000')).toBe('-4350.000')
  })

  it('reads Arabic-Indic digits and the Arabic separators', () => {
    expect(normaliseAmount('١٬٢٠٠٫٥٠٠')).toBe('1200.500')
    expect(normaliseAmount('۲۵۰')).toBe('250')
  })

  it('leaves what it cannot read unambiguously for the schema to refuse', () => {
    expect(normaliseAmount('1,2,3')).toBe('1,2,3')
    expect(normaliseAmount('1200,5')).toBe('1200,5')
    expect(normaliseAmount('1,200 300')).toBe('1,200 300')
    expect(normaliseAmount('12e3')).toBe('12e3')
  })

  it('leaves a plain amount exactly as it was', () => {
    expect(normaliseAmount('0.001')).toBe('0.001')
    expect(normaliseAmount('25000.000000')).toBe('25000.000000')
  })
})
