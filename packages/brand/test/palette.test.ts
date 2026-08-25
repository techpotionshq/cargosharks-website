/**
 * The colour maths, pinned to the two brands that were built by hand.
 *
 * `hexRamp` exists so that a client's brand manual — which states a hex and
 * nothing else — becomes a ramp without anybody repeating the conversion and
 * the gamut judgement that `brands/qabandi.ts` records in prose. These tests
 * are that prose, executed: while they pass, the generator still agrees with
 * the one ramp a designer actually tuned by eye.
 */

import { describe, expect, it } from 'vitest'
import {
  chromeRampFor,
  collidesWithStatus,
  hexRamp,
  maxRampChroma,
  neutralHueFor,
  oklchFromHex,
  ramp,
} from '../src/palette'

describe('oklchFromHex', () => {
  it('converts the Al-Qabandi red to the value its brand file records', () => {
    // brands/qabandi.ts: "Red #da2726 — oklch(0.574 0.213 27), measured off
    // the mark itself".
    const red = oklchFromHex('#da2726')
    expect(red.lightness).toBeCloseTo(0.574, 3)
    expect(red.chroma).toBeCloseTo(0.213, 3)
    expect(red.hue).toBeCloseTo(27.4, 1)
  })

  it('converts their navy to the value its brand file records', () => {
    // "Navy #1d2143 — oklch(0.264 0.063 276), their dark sections".
    const navy = oklchFromHex('#1d2143')
    expect(navy.lightness).toBeCloseTo(0.264, 2)
    expect(navy.chroma).toBeCloseTo(0.063, 3)
    expect(navy.hue).toBeCloseTo(276, 0)
  })

  it('accepts every form a brand manual writes a hex in', () => {
    const canonical = oklchFromHex('#ffcc00')
    for (const form of ['ffcc00', '#FFCC00', '#fc0', 'fc0', '  #ffcc00  ']) {
      expect(oklchFromHex(form)).toEqual(canonical)
    }
  })

  it('refuses anything that is not a hex colour', () => {
    for (const bad of ['', '#', 'red', '#gggggg', '#12345']) {
      expect(() => oklchFromHex(bad)).toThrow(/Not a hex colour/)
    }
  })
})

describe('hexRamp', () => {
  it('reproduces the peak chroma that was chosen by eye', () => {
    /*
      The calibration, and the reason MAX_CLIP_ERROR is 0.03 rather than a
      rounder number. `brands/qabandi.ts` lowered a measured 0.213 to 0.19
      because 0.213 pushes the 700–950 stops outside sRGB. If that constant is
      ever tidied, this is what notices.
    */
    expect(hexRamp('#da2726', { hueShift: 6 }).chroma).toBeCloseTo(0.19, 2)
  })

  it('leaves a colour the ramp can already carry alone', () => {
    // The navy measures 0.063, well inside what its hue holds at every stop,
    // so the clamp must not touch it.
    expect(hexRamp('#1d2143', { hueShift: -12 }).chroma).toBeCloseTo(0.063, 3)
  })

  it('never returns a peak the ramp cannot carry', () => {
    for (const hex of ['#da2726', '#0b5fff', '#ffd400', '#00a651', '#1d2143']) {
      const spec = hexRamp(hex)
      expect(spec.chroma).toBeLessThanOrEqual(maxRampChroma(spec.hue) + 1e-4)
    }
  })

  it('lowers an explicit chroma but cannot raise one past the ceiling', () => {
    expect(hexRamp('#da2726', { chroma: 0.05 }).chroma).toBeCloseTo(0.05, 4)
    expect(hexRamp('#da2726', { chroma: 0.4 }).chroma).toBeLessThan(0.2)
  })

  it('omits hueShift when there is none, so a generated file stays quiet', () => {
    expect(hexRamp('#0b5fff')).not.toHaveProperty('hueShift')
    expect(hexRamp('#0b5fff', { hueShift: 4 }).hueShift).toBe(4)
  })

  it('builds eleven stops that CSS can parse', () => {
    const scale = ramp(hexRamp('#da2726', { hueShift: 6 }))
    expect(Object.keys(scale)).toHaveLength(11)
    for (const stop of Object.values(scale)) {
      expect(stop).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/)
    }
  })
})

describe('the reserved status hues', () => {
  it('catches a brand colour that would read as a customs hold', () => {
    // The case that forced the rule: Al-Qabandi's corporate red sits on
    // `critical`, half a degree away.
    expect(collidesWithStatus(27.42)).toBe('critical')
    expect(collidesWithStatus(155)).toBe('positive')
  })

  it('leaves a brand colour that is merely nearby alone', () => {
    // The default blue is eleven degrees from `muted`, which is not tested at
    // all, and a long way from either colour that has to interrupt.
    expect(collidesWithStatus(261)).toBeNull()
    expect(collidesWithStatus(276.1)).toBeNull()
  })

  it('draws the boundary at fifteen degrees, either side', () => {
    expect(collidesWithStatus(42)).toBe('critical')
    expect(collidesWithStatus(43)).toBeNull()
    expect(collidesWithStatus(12)).toBe('critical')
    expect(collidesWithStatus(11)).toBeNull()
  })
})

describe('chromeRampFor / neutralHueFor', () => {
  it('reproduces both hand-built brands', () => {
    // brands/qabandi.ts — chromeRamp 'accent', neutralHue 276.
    expect(chromeRampFor(27.42, 276.1)).toBe('accent')
    expect(neutralHueFor(27.42, 276.1)).toBe(276.1)

    /*
      brands/cargosharks.ts — chromeRamp 'accent', neutralHue 257. The file
      says 257 and its accent is 256, so the hand-written value is one degree
      off what this returns. At the neutral ramp's chroma of 0.018 that is not
      a colour, it is a rounding; the point the test pins is that both brands
      tint their greys with the accent rather than the primary.
    */
    expect(chromeRampFor(261, 256)).toBe('accent')
    expect(neutralHueFor(261, 256)).toBe(256)
  })

  it('keeps a one-colour brand on its own ramp', () => {
    expect(chromeRampFor(261)).toBe('primary')
    expect(neutralHueFor(261)).toBe(261)
  })

  it('refuses to build a sidebar out of the alarm colour', () => {
    // One colour, and it is a red. There is no second hue to retreat to, so
    // the chrome goes neutral rather than becoming four hundred pixels of
    // "something is wrong".
    expect(chromeRampFor(27.42)).toBe('neutral')
  })

  it('will not retreat to an accent that is itself a status hue', () => {
    expect(chromeRampFor(27.42, 158)).toBe('neutral')
  })
})
