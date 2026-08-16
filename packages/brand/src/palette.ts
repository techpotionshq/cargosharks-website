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
  return alpha === undefined
    ? `oklch(${l} ${c} ${h})`
    : `oklch(${l} ${c} ${h} / ${round(alpha, 3)})`
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
  const stops = Object.keys(STOP_LIGHTNESS) as unknown as (keyof typeof STOP_LIGHTNESS)[]
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
    (key) => [key, oklch(lightness, STATUS_CHROMA[key] * chromaFactor, STATUS_HUES[key])] as const,
  )
  return Object.fromEntries(entries) as unknown as StatusColors
}

/** One categorical series slot, as lightness/chroma/hue rather than a hex. */
export interface ChartSlotSpec {
  readonly lightness: number
  readonly chroma: number
  readonly hue: number
}

/**
 * The categorical chart slots, in fixed order.
 *
 * Series colours are *not* free-hand, and they are **not** derived from the
 * brand hue. Al-Qabandi's corporate colour is a red at hue 27, which is also
 * where `critical` lives — so deriving slot 1 from the brand would put "alarm"
 * on an ordinary series and make the ops board lie. Charts therefore avoid red
 * entirely; the brand shows up in a chart through the surrounding chrome, not
 * through the bars.
 *
 * The defaults below are the output of a search over every hue at least 30
 * degrees clear of all four reserved status hues, scored by the weakest
 * adjacent pair under simulated protanopia and deuteranopia and filtered to
 * sets that pass in **both** themes — which is why one set serves light and
 * dark rather than needing two. The worst adjacent pair clears deuteranopia at
 * ΔE 15.6 against a target of 8, and the worst normal-vision pair at 15.9
 * against a floor of 15.
 *
 * **Changing a value here means re-running `validate_palette.js` for both
 * modes**, against `#ffffff` and against the dark surface.
 *
 * Assigned in order and never cycled: a fifth category folds into "other"
 * rather than reusing slot 1, because two different things in the same colour
 * is worse than one thing unnamed.
 */
export const DEFAULT_CHART_SLOTS: readonly ChartSlotSpec[] = [
  /** Indigo — the accent navy's own hue, so a chart still reads as Qabandi's. */
  { lightness: 0.55, chroma: 0.14, hue: 276 },
  /** Teal. */
  { lightness: 0.65, chroma: 0.11, hue: 195 },
  /** Green-gold, which lands on the green their own site already uses. */
  { lightness: 0.6, chroma: 0.15, hue: 126 },
  /** Violet. Lightened from 0.50 so it clears 3:1 on the dark surface too. */
  { lightness: 0.54, chroma: 0.13, hue: 312 },
]

export function chartSlots(specs: readonly ChartSlotSpec[] = DEFAULT_CHART_SLOTS): string[] {
  return specs.map((slot) => oklch(slot.lightness, slot.chroma, slot.hue))
}

/**
 * The brand colour at an arbitrary lightness on its own ramp.
 *
 * Chroma is interpolated from the same falloff table the stops use, so a value
 * placed between two stops sits *on* the ramp rather than beside it.
 */
function brandAt(spec: RampSpec, lightness: number): string {
  const stops = Object.keys(STOP_LIGHTNESS).map(Number) as (keyof typeof STOP_LIGHTNESS)[]

  // The ramp runs light -> dark, so find the pair this lightness falls between.
  let lower = stops[0]!
  let upper = stops[stops.length - 1]!
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!
    const b = stops[i + 1]!
    if (lightness <= STOP_LIGHTNESS[a] && lightness >= STOP_LIGHTNESS[b]) {
      lower = a
      upper = b
      break
    }
  }

  const span = STOP_LIGHTNESS[lower] - STOP_LIGHTNESS[upper]
  const t = span === 0 ? 0 : (STOP_LIGHTNESS[lower] - lightness) / span
  const chromaFactor =
    STOP_CHROMA_FACTOR[lower] + (STOP_CHROMA_FACTOR[upper] - STOP_CHROMA_FACTOR[lower]) * t

  const index = stops.indexOf(lower) + t
  const progress = index / (stops.length - 1)
  const hue = spec.hue + (spec.hueShift ?? 0) * progress

  return oklch(lightness, spec.chroma * chromaFactor, hue)
}

export interface ThemeSpec {
  readonly primary: ColorScale
  readonly accent: ColorScale
  readonly neutral: ColorScale
  /**
   * The ramp the navigation chrome is cut from.
   *
   * Separate from `primary` because the two are not the same decision. A brand
   * whose corporate colour is a saturated red does not want a red sidebar —
   * four hundred pixels of alarm beside a board whose whole job is to make one
   * held container stand out. Al-Qabandi's chrome is their secondary navy, and
   * red is spent only where it means something: the mark, a primary action, and
   * `critical`.
   */
  readonly chrome: ColorScale
  /**
   * Drives the neutral tint and the shadow hue — **not** necessarily the brand
   * hue. Tinting every grey in the product with a red brand hue turns the whole
   * interface pink; Al-Qabandi's own greys lean indigo (their site's muted grey
   * sits at hue 283), so the neutrals follow the navy instead.
   */
  readonly hue: number
  /**
   * The primary ramp's generator, so a theme can place the brand at a lightness
   * the eleven fixed stops do not offer.
   *
   * The dark theme needs exactly this: `600` is dark enough to look muted
   * against a dark canvas and `500` is light enough that white button text
   * drops to 3.7:1. The value that satisfies both sits between them.
   */
  readonly primarySpec: RampSpec
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
    /** The sidebar is the chrome ramp's darkest stop: the frame, not the page. */
    chrome: spec.chrome[950],
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
    /**
     * Text on a filled brand surface stays light in both themes.
     *
     * It was near-black here, which is right for a pale brand colour and wrong
     * for a saturated one: it turned every primary button into dark-on-salmon.
     * A red brand wants white on red in both themes, and `brand` below is dark
     * enough at `500` to carry it.
     */
    onBrand: oklch(0.985, 0.006, spec.hue),
    line: oklch(0.312, 0.016, spec.hue),
    lineStrong: oklch(0.392, 0.02, spec.hue),
    /**
     * `400` washed a saturated brand out to a pastel — Al-Qabandi's red
     * arrived as salmon. L 0.57 is the balance point: white label text clears
     * AA on it at 4.68:1, and it still stands 3.9:1 clear of the dark canvas.
     * For this brand it lands within a hair of their actual `#da2726`.
     */
    brand: brandAt(spec.primarySpec, 0.57),
    brandHover: brandAt(spec.primarySpec, 0.635),
    brandSoft: oklch(0.29, 0.05, spec.hue),
    brandSoftInk: spec.primary[200],
    accent: spec.accent[400],
    // Was a literal hue 75 — a brass value left over from the provisional
    // palette, which would have stayed brass no matter what a client supplied.
    accentSoft: spec.accent[900],
    focus: spec.primary[400],
    shadow: oklch(0.08, 0.02, spec.hue, 0.5),
    status: statusAt(0.735, 0.92),
    statusSoft: statusAt(0.3, 0.5),
  }
}
