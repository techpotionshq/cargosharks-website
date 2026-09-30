/**
 * The RFQ body an agent reads — pure, no database.
 *
 * Pinned from the first RFQ that reached a real inbox (KWI-ENQ-2026-00019): it
 * printed "Weight: 12500.000000 kg" and never said how many containers, so an
 * FCL agent could not price it without writing back (F71, F72).
 */

import { describe, expect, it } from 'vitest'
import { quantity, rfqBody, type SendRow } from './rate-request-send'

const row = (over: Partial<SendRow> = {}): SendRow => ({
  id: 'r1',
  token: 'abc123def456',
  mode: 'sea_fcl',
  originCode: 'CNNGB',
  originName: 'Ningbo',
  destinationCode: 'KWSWK',
  destinationName: 'Shuwaikh Port',
  readyOn: '2026-10-15',
  grossWeightKg: '12500.000000',
  volumeCbm: null,
  pieces: null,
  containerCount: 1,
  incoterm: 'FOB',
  reference: 'KWI-ENQ-2026-00019',
  contactEmail: 'agent@example.com',
  contactName: 'Usman (test)',
  ...over,
})

describe('quantity', () => {
  it('drops the stored decimal places and groups the thousands', () => {
    expect(quantity('12500.000000')).toBe('12,500')
    expect(quantity('1.200000')).toBe('1.2')
    expect(quantity('1234567.890000')).toBe('1,234,567.89')
    expect(quantity('0.500000')).toBe('0.5')
    expect(quantity('240')).toBe('240')
  })

  it('leaves anything that is not a plain number as it was', () => {
    expect(quantity('about 12')).toBe('about 12')
  })
})

describe('rfqBody', () => {
  it('prints the weight as a person writes it', () => {
    const body = rfqBody(row())
    expect(body).toContain('Weight:    12,500 kg')
    expect(body).not.toContain('12500.000000')
  })

  it('says how many containers on an FCL request', () => {
    expect(rfqBody(row())).toContain('Containers: 1')
    expect(rfqBody(row({ containerCount: 3 }))).toContain('Containers: 3')
  })

  it('says nothing about containers when there is no count, or no FCL', () => {
    expect(rfqBody(row({ containerCount: null }))).not.toContain('Containers:')
    expect(
      rfqBody(row({ mode: 'air', containerCount: null, volumeCbm: '1.200000' })),
    ).not.toContain('Containers:')
  })

  it('formats the volume too', () => {
    expect(rfqBody(row({ mode: 'sea_lcl', volumeCbm: '31.000000' }))).toContain('Volume:    31 cbm')
  })

  it('keeps the instruction that brings the reply home', () => {
    expect(rfqBody(row())).toContain('keeping the subject line')
  })
})
