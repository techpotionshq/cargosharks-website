/**
 * The registration line prints what is known and nothing else.
 *
 * Al-Qabandi's brand carried "Commercial Registration — · Customs Licence —"
 * as one string, so any document that printed it would have shown two labels
 * beside dashes. The numbers are the client's to supply and are not invented
 * here; until they arrive the line is empty.
 */

import { describe, expect, it } from 'vitest'
import { cargosharksBrand, qabandiBrand, registrationLine, type BrandDocuments } from '../src'

const withParts = (cr: string, licence: string): BrandDocuments => ({
  ...qabandiBrand.documents,
  registrations: [
    { labelEn: 'Commercial Registration', labelAr: 'السجل التجاري', value: cr },
    { labelEn: 'Customs Licence', labelAr: 'رخصة جمركية', value: licence },
  ],
})

describe('registrationLine', () => {
  it('prints nothing for Al-Qabandi until the numbers are supplied', () => {
    expect(registrationLine(qabandiBrand.documents, 'en')).toBe('')
    expect(registrationLine(qabandiBrand.documents, 'ar')).toBe('')
  })

  it('never prints a label beside a dash', () => {
    for (const locale of ['en', 'ar'] as const) {
      expect(registrationLine(qabandiBrand.documents, locale)).not.toContain('—')
    }
  })

  it('hides each part whose value is empty', () => {
    expect(registrationLine(withParts('12345', ''), 'en')).toBe('Commercial Registration 12345')
    expect(registrationLine(withParts('', 'CL-9'), 'ar')).toBe('رخصة جمركية CL-9')
    expect(registrationLine(withParts('   ', ''), 'en')).toBe('')
  })

  it('joins the parts that have values', () => {
    expect(registrationLine(withParts('12345', 'CL-9'), 'en')).toBe(
      'Commercial Registration 12345 · Customs Licence CL-9',
    )
  })

  it('falls back to the note when no part has a value', () => {
    expect(registrationLine(cargosharksBrand.documents, 'en')).toBe(
      'Demonstration environment — not a trading entity',
    )
  })
})

/*
  The demo's sign-in is identity too. The Al-Qabandi demo printed
  operations@cargosharks.example and the password cargosharks-demo.
*/
describe('the demo sign-in', () => {
  it('follows each brand and never wears the other one', () => {
    expect(qabandiBrand.demo.operationsEmail).toBe('operations@qabandi.example')
    expect(qabandiBrand.demo.password).toBe('qabandi-demo')
    expect(cargosharksBrand.demo.operationsEmail).toBe('operations@cargosharks.example')
    expect(cargosharksBrand.demo.password).toBe('cargosharks-demo')
    expect(JSON.stringify(qabandiBrand.demo)).not.toMatch(/cargosharks/i)
    expect(JSON.stringify(cargosharksBrand.demo)).not.toMatch(/qabandi|القبندي/i)
  })

  it("names the demo's entities and mailboxes for the brand", () => {
    expect(cargosharksBrand.demo).toMatchObject({
      homeEntityEn: 'CargoSharks Freight Technologies',
      regionalEntityEn: 'CargoSharks Logistics FZE',
      mailDomain: 'cargosharks.com',
      senderName: 'CargoSharks',
    })
    // Al-Qabandi's demo reads exactly as it did before it came from here.
    expect(qabandiBrand.demo).toMatchObject({
      homeEntityEn: 'Al-Qabandi Freight Services W.L.L.',
      regionalEntityEn: 'Al-Qabandi Logistics FZE',
      mailDomain: 'alqabandi.com',
      senderName: 'Al-Qabandi Freight',
    })
  })
})
