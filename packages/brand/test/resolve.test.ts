/**
 * What a `BRAND` value is allowed to do.
 *
 * The third case is the one worth having a test for. An unregistered key used
 * to resolve to the supplier's own brand, so a deployment provisioned with
 * `--brand acme` and no `acme.ts` started, worked, and put CargoSharks on
 * every screen the client showed a customer and every PDF they sent one.
 */

import { describe, expect, it } from 'vitest'
import { BRANDS, DEFAULT_BRAND_KEY, resolveBrand } from '../src/resolve'

describe('resolveBrand', () => {
  it('wears the supplier brand when BRAND is unset', () => {
    expect(resolveBrand({}).identity.key).toBe(DEFAULT_BRAND_KEY)
    // Whitespace is unset. A deployment platform that writes an empty value
    // for a variable nobody filled in is the common way this happens.
    expect(resolveBrand({ BRAND: '   ' }).identity.key).toBe(DEFAULT_BRAND_KEY)
  })

  it('resolves every registered key to itself', () => {
    for (const key of Object.keys(BRANDS)) {
      expect(resolveBrand({ BRAND: key }).identity.key).toBe(key)
    }
  })

  it('refuses an unregistered key rather than falling back', () => {
    expect(() => resolveBrand({ BRAND: 'acme' })).toThrow(/not a registered brand/)
  })

  it('names the keys that would have worked', () => {
    // The message is the whole value of the refusal: it has to say what to
    // type next, because it is read by whoever is provisioning at the time.
    expect(() => resolveBrand({ BRAND: 'acme' })).toThrow(/cargosharks, qabandi/)
    expect(() => resolveBrand({ BRAND: 'acme' })).toThrow(/brand:new/)
  })

  it('still applies environment overrides on top of a registered brand', () => {
    const brand = resolveBrand({ BRAND: 'qabandi', BRAND_NAME_EN: 'Acme Logistics' })
    expect(brand.identity.nameEn).toBe('Acme Logistics')
    expect(brand.identity.key).toBe('qabandi')
  })
})
