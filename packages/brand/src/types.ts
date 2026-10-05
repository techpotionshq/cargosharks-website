/**
 * The whitelabel contract — `FR-CP-01`, `NFR-16`.
 *
 * Everything a customer or partner can see that identifies the operator lives
 * in one object: names, palette, typography, logo geometry, domains, document
 * letterhead. Nothing in `apps/web` or `apps/service` hard-codes a colour, a
 * company name or a logo path — they read these tokens, which is what makes a
 * second operator a configuration change rather than a fork.
 *
 * The rule this file exists to protect: **if it differs between two operators,
 * it is a token here.** A hex value in a component is a bug, and
 * `scripts/check-brand.mjs` — run by `pnpm lint` — fails the build on one. It
 * was written after three files were found still printing a former default
 * brand's maroon, two of them onto customer-facing PDFs, because the check
 * this comment promised did not exist.
 */

/**
 * A 50–950 tonal ramp. Eleven stops rather than a hue plus a generator: the
 * mid-tones of a real brand are rarely the mathematical midpoint of its
 * extremes, and a client who hands over a brand manual hands over stops.
 */
export interface ColorScale {
  readonly 50: string
  readonly 100: string
  readonly 200: string
  readonly 300: string
  readonly 400: string
  readonly 500: string
  readonly 600: string
  readonly 700: string
  readonly 800: string
  readonly 900: string
  readonly 950: string
}

/**
 * Colours that carry operational meaning rather than identity.
 *
 * These are deliberately *not* part of the palette a whitelabel client picks
 * freely: "breached" must read as alarming and "on track" as calm in any
 * brand, and a client whose corporate red is also their success colour would
 * produce an ops board nobody can scan. A client may tune the hue; the
 * semantic assignment is ours.
 */
export interface StatusColors {
  /** On track, released, delivered, won. */
  readonly positive: string
  /** Approaching an SLA, awaiting action, a clock inside free time. */
  readonly caution: string
  /** Breached, held, overdue, lost — the colour that must interrupt. */
  readonly critical: string
  /** Informational, in transit, neutral progress. */
  readonly info: string
  /** Closed, cancelled, superseded — present but no longer live. */
  readonly muted: string
}

/**
 * The resolved surface and ink set for one appearance.
 *
 * Named by role, not by lightness, so the dark theme is a different set of
 * values for the same names rather than an inverted copy of the light one.
 */
export interface ThemeColors {
  /** The page itself. */
  readonly canvas: string
  /** Cards and panels sitting on the canvas. */
  readonly surface: string
  /** A panel raised above a card — popovers, sticky headers. */
  readonly surfaceRaised: string
  /** Table stripes, inset wells, disabled fields. */
  readonly surfaceSunken: string
  /** The navigation chrome, which is brand-coloured rather than neutral. */
  readonly chrome: string
  readonly chromeInk: string
  readonly chromeInkMuted: string
  readonly chromeLine: string
  /** Primary body text. */
  readonly ink: string
  /** Labels, secondary values, column headers. */
  readonly inkMuted: string
  /** Timestamps, hints, the third level of the hierarchy. */
  readonly inkSubtle: string
  /** Text on a filled brand surface. */
  readonly onBrand: string
  readonly line: string
  readonly lineStrong: string
  /** The brand colour as used for interactive text and fills in this theme. */
  readonly brand: string
  readonly brandHover: string
  readonly brandSoft: string
  readonly brandSoftInk: string
  readonly accent: string
  readonly accentSoft: string
  /**
   * The focus ring. Never the brand when the brand sits on a status hue — a
   * red ring on a focused field reads as a validation error (`focusFor`).
   */
  readonly focus: string
  readonly shadow: string
  readonly status: StatusColors
  /** Tints of the status colours, for pill backgrounds. */
  readonly statusSoft: StatusColors
}

export interface BrandTypography {
  /** Latin UI face. */
  readonly sans: string
  /** Arabic UI face — listed first for `[lang='ar']` (§11). */
  readonly arabic: string
  /** References, container numbers, money. Tabular by construction. */
  readonly mono: string
  /** Optional display face for headings and the wordmark. */
  readonly display: string
  /** Wordmark tracking, in em. Gulf wordmarks are often widely tracked. */
  readonly wordmarkTracking: string
  readonly wordmarkWeight: number
}

export interface BrandShape {
  /** Base corner radius in px; every other radius derives from it. */
  readonly radius: number
  /** The logo tile's radius as a fraction of its size. */
  readonly logoRadius: number
  /** Border width in px. Some brands are hairline, some are not. */
  readonly borderWidth: number
}

/**
 * The logo, expressed as geometry rather than as a file.
 *
 * A PNG cannot recolour itself for a dark ops sidebar, a white letterhead and
 * a 32px favicon, and every attempt to keep three files in sync eventually
 * ships the wrong one. `mark` is drawn from the palette at render time, so it
 * is correct on any background by construction.
 *
 * When the client's own artwork arrives (Pilot §5, item 4), `markSvg` is
 * overridden with their supplied SVG and everything downstream is unchanged.
 */
export interface BrandLogo {
  /**
   * Which built-in mark to draw. `custom` uses `customSvg` verbatim, which is
   * the path a real brand manual takes.
   */
  readonly kind: 'monogram' | 'custom'
  /** Required when `kind` is `custom`. Must be a square `viewBox` SVG. */
  readonly customSvg?: string
  /** The letter drawn in the monogram tile. */
  readonly monogramLetter: string
  /** Waves under the monogram — a maritime tell, and optional. */
  readonly showWaves: boolean
  /** Shown in the tab and on the tracking page. */
  readonly favicon: string
}

export interface BrandIdentity {
  /** Machine key. Also the value a `BRAND` env var selects. */
  readonly key: string
  readonly nameEn: string
  readonly nameAr: string
  /** The full legal name, for documents and the footer. */
  readonly legalNameEn: string
  readonly legalNameAr: string
  /** Two or three characters for the collapsed sidebar and the favicon. */
  readonly shortName: string
  readonly taglineEn: string
  readonly taglineAr: string
  /** Founded year, shown in the footer. Empty string omits it. */
  readonly established: string
}

export interface BrandContact {
  readonly websiteUrl: string
  readonly portalUrl: string
  /** The domain Moment 1 is demonstrated on (Pilot §2). */
  readonly trackingUrl: string
  readonly supportEmail: string
  readonly supportPhone: string
  readonly addressEn: string
  readonly addressAr: string
}

/**
 * Document-side identity — quotation and delivery-order letterhead
 * (`FR-EQ-08`, `FR-DC-08`).
 *
 * Kept in the same object as the screen tokens because the pilot's whole
 * premise is that the PDF and the screen are visibly the same company, and
 * two sources of truth is how they drift apart.
 */
/**
 * One registration a document prints under the letterhead: a commercial
 * registration, a customs licence, a tax number.
 *
 * Label and value are separate so that an unknown number prints *nothing*
 * rather than its label beside a dash. The line this replaced was one string,
 * "Commercial Registration — · Customs Licence —", and it was waiting to print
 * on every quotation and invoice until the client supplied the numbers.
 */
export interface BrandRegistration {
  readonly labelEn: string
  readonly labelAr: string
  /** The number itself. Empty means "not supplied", and the part is left out. */
  readonly value: string
}

export interface BrandDocuments {
  /** Printed under the letterhead, each only when it has a value. */
  readonly registrations: readonly BrandRegistration[]
  /**
   * Printed in the same place when no registration has a value — a demo
   * tenant's "not a trading entity". Empty prints nothing.
   */
  readonly registrationNoteEn: string
  readonly registrationNoteAr: string
  readonly footerEn: string
  readonly footerAr: string
  /** Standard trading conditions reference printed on quotations. */
  readonly tradingConditionsEn: string
  readonly tradingConditionsAr: string
}

/**
 * The public demo's way in — `QABANDI_DEMO_LOGIN=1` prints both on the sign-in
 * screen and prefills the address.
 *
 * Part of the brand because it is read as identity. The Al-Qabandi demo
 * printed `operations@cargosharks.example` and the password
 * `cargosharks-demo`: the supplier's name on the client's sign-in screen. Each
 * brand now carries its own, and by default derives them from its key, so a
 * new brand never inherits another's.
 */
export interface BrandDemo {
  /** The operations persona's address. Always a reserved `.example` domain. */
  readonly operationsEmail: string
  /** The shared password when `QABANDI_DEMO_PASSWORD` is unset. */
  readonly password: string
}

export interface Brand {
  readonly identity: BrandIdentity
  readonly contact: BrandContact
  readonly documents: BrandDocuments
  readonly demo: BrandDemo
  readonly logo: BrandLogo
  readonly typography: BrandTypography
  readonly shape: BrandShape
  readonly palette: {
    readonly primary: ColorScale
    readonly accent: ColorScale
    readonly neutral: ColorScale
    /** The categorical series, resolved and in assignment order. */
    readonly chart: readonly string[]
  }
  readonly light: ThemeColors
  readonly dark: ThemeColors
}

/** A partial override, as an env file or a client's brand manual supplies it. */
export type BrandOverride = {
  readonly [K in keyof Brand]?: Partial<Brand[K]>
}
