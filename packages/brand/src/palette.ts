/**
 * Palette construction.
 *
 * Every colour in the product is OKLCH. The reason is practical rather than
 * fashionable: OKLCH's lightness axis is perceptual, so `500` in the brand
 * ramp and `500` in the status ramp weigh the same on screen, and a whitelabel
 * client who supplies one brand hue gets a ramp that stays legible at every
 * stop instead of a mid-tone that vanishes against the page.
 *
 * A brand supplies two ramps — primary and accent. Everything else, including
 * both themes, is derived here. That is what keeps `defineBrand` in
 * `brand.ts` down to an identity block and two hues.
 */

import type { ColorScale, StatusColors, ThemeColors } from './types'

/** `oklch(L C H)` with the numbers rounded to the precision CSS needs. */
export function oklch(lightness: number, chroma: number, hue: number, alpha?: number): string {
  const l = round(lightness, 4)
  const c = round(chroma, 4)
  const h = round(hue, 2)
  return alpha === undefined ? `oklch(${l} ${c} ${h})` : `oklch(${l} ${c} ${h} / ${round(alpha, 3)})`
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * The lightness of each stop, fixed across every ramp.
 *
 * Shared stops are what let a component say "`600` on `50`" once and have that
 * pairing hold its contrast in the brand ramp, the accent ramp and any ramp a
 * future client brings.
 */
const STOP_LIGHTNESS = {
  50: 0.975,
  100: 0.945,
  200: 0.892,
  300: 0.822,
  400: 0.727,
  500: 0.625,
  600: 0.532,
  700: 0.448,
  800: 0.372,
  900: 0.302,
  950: 0.226,
} as const

/**
 * Chroma as a fraction of the ramp's peak.
 *
 * Chroma has to fall away at both ends or the light stops turn to pastel mud
 * and the dark stops go black — an even ramp is the single most common way a
 * generated palette looks synthetic.
 */
const STOP_CHROMA_FACTOR = {
  50: 0.14,
  100: 0.28,
  200: 0.48,
  300: 0.7,
  400: 0.9,
  500: 1,
  600: 0.98,
  700: 0.88,
  800: 0.74,
  900: 0.6,
  950: 0.46,
} as const

export interface RampSpec {
  /** OKLCH hue angle, 0–360. */
  readonly hue: number
  /** Peak chroma at the 500 stop. Around 0.13 for a strong brand colour. */
  readonly chroma: number
  /**
   * Hue drift from the 50 stop to the 950 stop, in degrees.
   *
   * Real pigments shift as they darken — navy goes cooler, gold goes redder.
   * A ramp with a single fixed hue is the other reliable tell of a generated
   * palette.
   */
  readonly hueShift?: number
}

/** Builds an eleven-stop ramp from one hue. */
export function ramp(spec: RampSpec): ColorScale {
  const shift = spec.hueShift ?? 0
  const stops = Object.keys(STOP_LIGHTNESS) as unknown as (keyof typeof STOP_LIGHTNESS)[];
  const entries = stops.map((stop, index) => {
    const progress = index / (stops.length - 1)
    return [
      stop,
      oklch(
        STOP_LIGHTNESS[stop],
        spec.chroma * STOP_CHROMA_FACTOR[stop],
        spec.hue + shift * progress,
      ),
    ] as const
  })
  return Object.fromEntries(entries) as unknown as ColorScale
}

/**
 * The neutral ramp carries a trace of the brand hue.
 *
 * A pure grey next to a saturated brand colour reads as dirty. Two or three
 * hundredths of chroma is invisible as colour and is the difference between a
 * page that looks composed and one that looks like a wireframe.
 */
export function neutralRamp(hue: number): ColorScale {
  return ramp({ hue, chroma: 0.018 })
}

/**
 * Status hues.
 *
 * A whitelabel client may nudge these — some brands own a particular green —
 * but the *assignment* is not theirs to change: an ops board where "breached"
 * is calm is worse than useless. See `StatusColors` in `types.ts`.
 */
export const STATUS_HUES = {
  positive: 158,
  caution: 78,
  critical: 27,
  info: 232,
  muted: 250,
} as const

const STATUS_CHROMA = {
  positive: 0.13,
  caution: 0.14,
  critical: 0.16,
  info: 0.11,
  muted: 0.02,
} as const

type StatusKey = keyof typeof STATUS_HUES

function statusAt(lightness: number, chromaFactor: number): StatusColors {
  const keys = Object.keys(STATUS_HUES) as StatusKey[]
  const entries = keys.map(
    (key) =>
      [key, oklch(lightness, STATUS_CHROMA[key] * chromaFactor, STATUS_HUES[key])] as const,
  )
  return Object.fromEntries(entries) as unknown as StatusColors
}

/**
 * The categorical chart slots, in fixed order.
 *
 * Series colours are *not* free-hand. These four are the output of the palette
 * validator — lightness band, chroma floor, adjacent-pair separation under
 * simulated protanopia and deuteranopia, and contrast against both surfaces —
 * and every one passes in **both** themes, which is why the same four values
 * serve light and dark rather than needing a second set.
 *
 * Two properties worth keeping when a whitelabel client's hues arrive:
 *
 *   - Slots 1 and 2 follow the brand's own primary and accent hues, so a chart
 *     looks like it belongs to the operator rather than to the framework.
 *   - Slots 3 and 4 are fixed support hues, spaced to survive colour blindness
 *     next to their neighbours. **Changing a hue here means re-running
 *     `validate_palette.js` for both modes.** The worst adjacent pair currently
 *     clears deuteranopia at ΔE 13.0 against a floor of 8.
 *
 * Assigned in order and never cycled: a fifth category folds into "other"
 * rather than reusing slot 1, because two different things in the same colour
 * is worse than one thing unnamed. Status colours never appear here — they are
 * reserved for state, and a series wearing "critical" red makes the board lie.
 */
export function chartSlots(primaryHue: number, accentHue: number): string[] {
  return [
    oklch(0.625, 0.118, primaryHue),
    oklch(0.625, 0.125, accentHue),
    oklch(0.635, 0.108, 196),
    oklch(0.52, 0.15, 315),
  ]
}

export interface ThemeSpec {
  readonly primary: ColorScale
  readonly accent: ColorScale
  readonly neutral: ColorScale
  /** Drives the neutral tint and the shadow hue. */
  readonly hue: number
}

/**
 * The light theme.
 *
 * Deliberately not white-on-white: the canvas is a hair off-white and cards
 * are pure white, so a card reads as a card without needing a border. On the
 * ops board — the densest screen in the product — that is what stops forty
 * rows of data from looking like one undifferentiated sheet.
 */
export function lightTheme(spec: ThemeSpec): ThemeColors {
  return {
    canvas: oklch(0.981, 0.004, spec.hue),
    surface: oklch(1, 0, 0),
    surfaceRaised: oklch(1, 0, 0),
    surfaceSunken: oklch(0.965, 0.006, spec.hue),
    /** The sidebar is the brand's darkest stop: the frame, not the page. */
    chrome: spec.primary[950],
    chromeInk: oklch(0.97, 0.008, spec.hue),
    chromeInkMuted: oklch(0.78, 0.018, spec.hue),
    chromeLine: oklch(0.34, 0.028, spec.hue),
    ink: oklch(0.24, 0.016, spec.hue),
    inkMuted: oklch(0.5, 0.014, spec.hue),
    inkSubtle: oklch(0.62, 0.012, spec.hue),
    onBrand: oklch(0.99, 0.004, spec.hue),
    line: oklch(0.912, 0.006, spec.hue),
    lineStrong: oklch(0.848, 0.009, spec.hue),
    brand: spec.primary[600],
    brandHover: spec.primary[700],
    brandSoft: spec.primary[50],
    brandSoftInk: spec.primary[800],
    accent: spec.accent[600],
    accentSoft: spec.accent[50],
    focus: spec.primary[500],
    shadow: oklch(0.24, 0.03, spec.hue, 0.09),
    status: statusAt(0.52, 1),
    statusSoft: statusAt(0.955, 0.55),
  }
}

/**
 * The dark theme.
 *
 * Not an inversion. The canvas is a very dark tint of the brand hue rather
 * than black, surfaces step *up* in lightness, and the brand colour moves to a
 * lighter stop because `600` on a dark canvas fails contrast. Inverting the
 * light theme instead of re-specifying it is what produces the familiar
 * grey-on-grey dark mode nobody can read.
 */
export function darkTheme(spec: ThemeSpec): ThemeColors {
  return {
    canvas: oklch(0.171, 0.014, spec.hue),
    surface: oklch(0.212, 0.016, spec.hue),
    surfaceRaised: oklch(0.246, 0.018, spec.hue),
    surfaceSunken: oklch(0.192, 0.014, spec.hue),
    chrome: oklch(0.196, 0.02, spec.hue),
    chromeInk: oklch(0.955, 0.006, spec.hue),
    chromeInkMuted: oklch(0.73, 0.014, spec.hue),
    chromeLine: oklch(0.315, 0.018, spec.hue),
    ink: oklch(0.955, 0.006, spec.hue),
    inkMuted: oklch(0.752, 0.012, spec.hue),
    inkSubtle: oklch(0.638, 0.014, spec.hue),
    onBrand: oklch(0.16, 0.02, spec.hue),
    line: oklch(0.312, 0.016, spec.hue),
    lineStrong: oklch(0.392, 0.02, spec.hue),
    brand: spec.primary[400],
    brandHover: spec.primary[300],
    brandSoft: oklch(0.29, 0.05, spec.hue),
    brandSoftInk: spec.primary[200],
    accent: spec.accent[400],
    accentSoft: oklch(0.3, 0.045, 75),
    focus: spec.primary[400],
    shadow: oklch(0.08, 0.02, spec.hue, 0.5),
    status: statusAt(0.735, 0.92),
    statusSoft: statusAt(0.3, 0.5),
  }
}
