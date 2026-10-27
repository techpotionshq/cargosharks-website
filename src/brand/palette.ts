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
 * brand hue. The rule is: a chart series stays clear of the brand hue and of
 * all four reserved status hues. The case that forced it was a red brand —
 * Al-Qabandi's corporate colour is a red at hue 27, which is also where
 * `critical` lives, so deriving slot 1 from that brand would have put "alarm"
 * on an ordinary series and made the ops board lie. Fixing the slots instead of
 * deriving them means the rule holds for whatever hue the next brand arrives
 * with; the brand shows up in a chart through the surrounding chrome, not
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
 * One honest caveat about the current default. CargoSharks is a blue at hue
 * 261, fifteen degrees from slot 1's indigo at 276 — close enough to notice
 * when a bar sits beside a primary button. That is not the failure this rule
 * guards against, which is a series reading as a *status*: 276 still clears
 * `info` at 232 by forty-four degrees, and a first series near the chrome reads
 * as house style rather than as an alarm. Leave it. It becomes worth revisiting
 * only if slot 1 has to be told apart from a brand-filled element inside the
 * same frame — a selected row behind a sparkline, say — and the fix then is to
 * move slot 1 and re-run the validator, never to derive it from the brand.
 *
 * Assigned in order and never cycled: a fifth category folds into "other"
 * rather than reusing slot 1, because two different things in the same colour
 * is worse than one thing unnamed.
 */
export const DEFAULT_CHART_SLOTS: readonly ChartSlotSpec[] = [
  /**
   * Indigo. Chosen for its distance from the status hues, not from any brand —
   * though the search landing here rather than on some other clear hue is no
   * accident: 276 is the qabandi brand's own navy.
   */
  { lightness: 0.55, chroma: 0.14, hue: 276 },
  /** Teal. */
  { lightness: 0.65, chroma: 0.11, hue: 195 },
  /** Green-gold, which lands on the green Al-Qabandi's own site already uses. */
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
   * held container stand out. That is why `qabandi` cuts its chrome from the
   * secondary navy and spends red only where it means something: the mark, a
   * primary action, and `critical`. Brands whose primary is calm enough to
   * carry a sidebar still set this deliberately rather than by default —
   * `cargosharks` names its navy accent too, because the blue is wanted for
   * actions.
   */
  readonly chrome: ColorScale
  /**
   * Drives the neutral tint and the shadow hue — **not** necessarily the brand
   * hue. Tinting every grey in the product with a red brand hue turns the whole
   * interface pink, which is why `qabandi` points its neutrals at the navy
   * instead (their own site's muted grey sits at hue 283, so that is where the
   * greys already leaned). A brand whose primary is not hostile to a grey can
   * point this at the primary; both registered brands still state it, because
   * the value inherited by accident is the one nobody checks.
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
 * The colour of the focus ring.
 *
 * The brand's own 500 by default, which is what every brand wants — unless
 * the brand sits on a status hue. Qabandi's red is at hue 27, which is where
 * `critical` lives, and a focused field drawn in it was indistinguishable from
 * a field that had just failed validation: tabbing through a clean form looked
 * like walking through a list of errors. In that case the ring moves to the
 * accent, which the chrome already uses and which nobody reads as an alarm.
 *
 * Decided from the hue, not per brand, so the next client with a red or a
 * green arrives correct rather than with a note in their brand file.
 */
function focusFor(spec: ThemeSpec, theme: 'light' | 'dark'): string {
  const ramp = collidesWithStatus(spec.primarySpec.hue) === null ? spec.primary : spec.accent
  return theme === 'light' ? ramp[500] : ramp[400]
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
    canvas: oklch(0.975, 0.005, spec.hue),
    surface: oklch(1, 0, 0),
    surfaceRaised: oklch(1, 0, 0),
    surfaceSunken: oklch(0.965, 0.006, spec.hue),
    /**
     * The rail is light in the light theme.
     *
     * It used to be the chrome ramp's darkest stop, on the reasoning that the
     * frame should be visibly the frame. That reasoning holds for a chrome
     * that carries navigation *and nothing else*; it stops holding once the
     * rail also carries counts, a workspace switcher and a user card, because
     * a dark slab beside a white board splits the screen into two products.
     *
     * A hair darker than the canvas and a hair cooler, so the rail still
     * reads as structure while every element inside it uses the same ink
     * scale as the page. The dark theme keeps a genuinely dark chrome, where
     * the same reasoning points the other way.
     */
    chrome: oklch(0.988, 0.003, spec.hue),
    chromeInk: oklch(0.24, 0.016, spec.hue),
    chromeInkMuted: oklch(0.52, 0.014, spec.hue),
    chromeLine: oklch(0.915, 0.006, spec.hue),
    ink: oklch(0.24, 0.016, spec.hue),
    inkMuted: oklch(0.5, 0.014, spec.hue),
    /*
      L 0.55, not 0.62. The third level of the hierarchy carries timestamps,
      hints and every column header, and at 0.62 it measured 3.6:1 on white
      and 3.4:1 on the canvas — under AA for text that small. 0.55 clears
      4.5:1 on both and still sits visibly below `inkMuted`.
    */
    inkSubtle: oklch(0.55, 0.012, spec.hue),
    onBrand: oklch(0.99, 0.004, spec.hue),
    line: oklch(0.912, 0.006, spec.hue),
    /*
      The boundary of a control, not of a card.

      `line` is for separating things that are already legible on their own —
      a card from the canvas, one table row from the next — and at 1.3:1 it is
      right for that. An empty text field has nothing else to find it by, so
      its edge needs about 3:1 (WCAG 1.4.11). L 0.70 is as dark as a hairline
      can go before a form reads as a grid of boxes; the field kit pairs it
      with an `inkSubtle` hover so the step up is still visible.
    */
    lineStrong: oklch(0.7, 0.012, spec.hue),
    brand: spec.primary[600],
    brandHover: spec.primary[700],
    brandSoft: spec.primary[50],
    brandSoftInk: spec.primary[800],
    accent: spec.accent[600],
    accentSoft: spec.accent[50],
    focus: focusFor(spec, 'light'),
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
    // Raised from 0.392 for the reason the light theme's was lowered: it is
    // the edge of a text field, and at 0.392 a field on a card vanished.
    lineStrong: oklch(0.47, 0.02, spec.hue),
    /**
     * `400` washed a saturated brand out to a pastel — Al-Qabandi's red
     * arrived as salmon. L 0.57 is the balance point: white label text clears
     * AA on it at 4.68:1, and it still stands 3.9:1 clear of the dark canvas.
     * For that brand it lands within a hair of their actual `#da2726`.
     */
    brand: brandAt(spec.primarySpec, 0.57),
    brandHover: brandAt(spec.primarySpec, 0.635),
    brandSoft: oklch(0.29, 0.05, spec.hue),
    brandSoftInk: spec.primary[200],
    accent: spec.accent[400],
    // Was a literal hue 75 — a brass value left over from the provisional
    // palette, which would have stayed brass no matter what a client supplied.
    accentSoft: spec.accent[900],
    focus: focusFor(spec, 'dark'),
    shadow: oklch(0.08, 0.02, spec.hue, 0.5),
    status: statusAt(0.735, 0.92),
    statusSoft: statusAt(0.3, 0.5),
  }
}

// --- a client's hex, converted once ----------------------------------------

/**
 * The one question a brand manual always asks and this package could not
 * answer: *the client's red is `#da2726` — what is that in OKLCH?*
 *
 * It was answered by hand for both registered brands, and the working is in
 * the header of `brands/qabandi.ts`: measure the mark, convert, then lower the
 * peak chroma until the dark stops stop clipping. That is fine twice and is a
 * source of quiet error by the fifth client, because a ramp that clips does
 * not look broken — it looks flat, exactly where the interface needed
 * separation, and only at the stops nobody screenshots.
 *
 * `hexRamp('#da2726')` is that whole procedure. A generated brand file then
 * carries the hex the client actually supplied, which can be checked against
 * the brand manual, instead of three decimals which cannot.
 */

/** OKLCH as numbers, before `oklch()` renders it. */
export interface OklchValue {
  readonly lightness: number
  readonly chroma: number
  /** Degrees, 0–360. */
  readonly hue: number
}

/** sRGB gamma decode — the piecewise transfer function, not the 2.2 shorthand. */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Linear sRGB to OKLab, by Björn Ottosson's matrices. */
function linearToOklab(
  red: number,
  green: number,
  blue: number,
): { lightness: number; a: number; b: number } {
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)

  return {
    lightness: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  }
}

/**
 * `#rrggbb` to OKLCH.
 *
 * Accepts `#rgb`, `#rrggbb` and either without the hash, because a brand
 * manual writes it every one of those ways.
 */
export function oklchFromHex(hex: string): OklchValue {
  const digits = hex.trim().replace(/^#/, '')
  const expanded = digits.length === 3 ? digits.replace(/./g, (digit) => digit + digit) : digits

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: "${hex}". Expected #rgb or #rrggbb.`)
  }

  const value = Number.parseInt(expanded, 16)
  const lab = linearToOklab(
    toLinear(((value >> 16) & 0xff) / 255),
    toLinear(((value >> 8) & 0xff) / 255),
    toLinear((value & 0xff) / 255),
  )

  const hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI

  return {
    lightness: lab.lightness,
    chroma: Math.hypot(lab.a, lab.b),
    hue: hue < 0 ? hue + 360 : hue,
  }
}

/**
 * How far a colour moves when sRGB cannot hold it, as an OKLab distance.
 *
 * OKLCH can name colours no screen can show. CSS does not refuse those — it
 * clips them, per channel, silently. Measuring the *displacement* rather than
 * asking a yes-or-no gamut question is the whole difference between a usable
 * clamp and a useless one: at the 950 stop the sRGB gamut is so narrow that
 * "must not clip at all" costs a red brand more than half its chroma at 500,
 * where the brand actually lives, to rescue a stop nobody can tell apart.
 */
function clipError(lightness: number, chroma: number, hue: number): number {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)

  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  const shown = linearToOklab(
    clamp01(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    clamp01(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    clamp01(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  )

  return Math.hypot(lightness - shown.lightness, a - shown.a, b - shown.b)
}

/**
 * How much displacement a ramp may carry at its worst stop.
 *
 * Not a guess. `brands/qabandi.ts` is the one ramp in this repository whose
 * peak was set by eye — 0.19, chosen against a measured 0.213 by lowering it
 * until the dark stops stopped going flat. This tolerance reproduces that
 * decision at 0.1895, which is the same ramp to the precision `oklch()`
 * prints. So the constant is calibrated against a designer, and the test that
 * pins it is the guard against somebody later tidying it to a round number.
 */
const MAX_CLIP_ERROR = 0.03

/**
 * The largest peak chroma this ramp can carry before a stop visibly clips.
 *
 * The binding constraint is rarely the 500 stop the brand was measured at: for
 * a warm hue it is the dark end, for a yellow the light end. Every stop is
 * checked and the search returns the peak that satisfies all eleven.
 */
export function maxRampChroma(hue: number, hueShift = 0): number {
  const stops = Object.keys(STOP_LIGHTNESS) as unknown as (keyof typeof STOP_LIGHTNESS)[]

  const worstError = (peak: number): number =>
    Math.max(
      ...stops.map((stop, index) =>
        clipError(
          STOP_LIGHTNESS[stop],
          peak * STOP_CHROMA_FACTOR[stop],
          hue + hueShift * (index / (stops.length - 1)),
        ),
      ),
    )

  // Displacement rises monotonically with peak chroma, so a bisection finds
  // the edge. 0.4 is beyond any sRGB colour; thirty halvings put the answer
  // well inside the rounding `oklch()` applies anyway.
  let low = 0
  let high = 0.4
  for (let step = 0; step < 30; step += 1) {
    const mid = (low + high) / 2
    if (worstError(mid) <= MAX_CLIP_ERROR) low = mid
    else high = mid
  }
  return low
}

export interface HexRampOptions {
  /** Hue drift from the 50 stop to the 950 stop, in degrees. */
  readonly hueShift?: number
  /**
   * Peak chroma, overriding the one measured from the hex.
   *
   * For a brand whose corporate colour is more saturated than it wants its
   * whole interface to be. Still clamped — this can lower the peak, never
   * raise it past what the ramp can carry.
   */
  readonly chroma?: number
}

/**
 * A `RampSpec` from the colour a client actually handed over.
 *
 * The clamp is the point. `#da2726` measures 0.213 and no eleven-stop ramp can
 * hold that; this returns the peak that survives every stop, so a generated
 * brand cannot ship the flat dark end that both hand-built brands had to be
 * talked out of.
 */
export function hexRamp(hex: string, options: HexRampOptions = {}): RampSpec {
  const measured = oklchFromHex(hex)
  const hueShift = options.hueShift ?? 0
  const ceiling = maxRampChroma(measured.hue, hueShift)

  return {
    hue: round(measured.hue, 2),
    chroma: round(Math.min(options.chroma ?? measured.chroma, ceiling), 4),
    ...(hueShift === 0 ? {} : { hueShift }),
  }
}

/**
 * How close a brand hue may come to a reserved status hue, in degrees.
 *
 * From the note in `.env.example`: *"A brand hue within ~15 degrees of one of
 * those reads as that status."*
 */
const STATUS_CLEARANCE = 15

/** Shortest angular distance between two hues, in degrees. */
function hueDistance(a: number, b: number): number {
  const delta = Math.abs((((a - b) % 360) + 360) % 360)
  return Math.min(delta, 360 - delta)
}

/**
 * The status colour a brand hue would be mistaken for, if any.
 *
 * Only `critical` and `positive` are tested, and the omissions are deliberate.
 * `muted` sits at 250 with a chroma of 0.02, so its hue is invisible and
 * constrains nothing — which is why the default blue at 261 has always been
 * fine eleven degrees away. `caution` and `info` are not tested because
 * neither has to *interrupt*: a brand that reads faintly informational costs
 * nothing, and a brand that reads as a customs hold costs an operator the one
 * colour that was supposed to stop them.
 */
export function collidesWithStatus(hue: number): 'critical' | 'positive' | null {
  if (hueDistance(hue, STATUS_HUES.critical) <= STATUS_CLEARANCE) return 'critical'
  if (hueDistance(hue, STATUS_HUES.positive) <= STATUS_CLEARANCE) return 'positive'
  return null
}

/**
 * Which ramp the navigation chrome should be cut from.
 *
 * Both hand-built brands reached for the accent independently, and the reason
 * generalises: the chrome is four hundred pixels of permanent furniture, and a
 * brand's second colour is almost always its calmer one.
 *
 * A brand that supplies only one colour keeps the chrome on it — unless that
 * colour sits on a status hue, in which case the sidebar would be a wall of
 * alarm colour and a real customs hold would have nothing left to jump off the
 * board with. Then the neutrals carry the chrome instead.
 *
 * Worth knowing before trusting the result: **nothing reads the ramp this
 * selects today.** `defineBrand` resolves it into `ThemeSpec.chrome`, and
 * neither `lightTheme` nor `darkTheme` reads that field — both build the rail
 * from `hue`, which is `neutralHue`. So this records an intention, and
 * `neutralHueFor` is what actually tints the chrome. Both hand-written brands
 * still state it, and it is the value a rewired rail would read.
 */
export function chromeRampFor(
  primaryHue: number,
  accentHue?: number,
): 'primary' | 'accent' | 'neutral' {
  if (accentHue !== undefined && collidesWithStatus(accentHue) === null) return 'accent'
  return collidesWithStatus(primaryHue) === null ? 'primary' : 'neutral'
}

/**
 * The hue that tints every neutral and every shadow.
 *
 * The accent when there is one, so the greys agree with the chrome they sit
 * against rather than pulling the other way. Both hand-built brands do this:
 * `qabandi` tints at 276 against a primary at 27, and `cargosharks` at 257
 * against a primary at 261. Each of those is its own accent hue — 276.1 and
 * 256 — written to the nearest degree, which at the neutral ramp's chroma of
 * 0.018 is the same grey.
 */
export function neutralHueFor(primaryHue: number, accentHue?: number): number {
  return accentHue ?? primaryHue
}
