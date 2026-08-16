/**
 * `defineBrand` — the whole whitelabel surface, in one call.
 *
 * A second operator supplies an identity block, two hue specifications and a
 * monogram letter. Both themes, all three ramps, every semantic colour, the
 * logo and the document letterhead fall out of that. The measure of whether
 * this file is doing its job: onboarding a new operator should not require
 * touching `apps/web` at all.
 */

import {
  chartSlots,
  darkTheme,
  DEFAULT_CHART_SLOTS,
  lightTheme,
  neutralRamp,
  ramp,
  type ChartSlotSpec,
  type RampSpec,
} from './palette'
import type {
  Brand,
  BrandContact,
  BrandDocuments,
  BrandIdentity,
  BrandLogo,
  BrandShape,
  BrandTypography,
} from './types'

export interface BrandSpec {
  readonly identity: BrandIdentity
  readonly contact: BrandContact
  readonly documents: BrandDocuments
  /** The corporate colour — the mark, primary actions, brand moments. */
  readonly primary: RampSpec
  /** The secondary, used for the chrome, highlights and chart accents. */
  readonly accent: RampSpec
  /**
   * Which ramp the navigation chrome is cut from. Defaults to `primary`,
   * which is right for a brand whose corporate colour is already dark and
   * calm, and wrong for one whose corporate colour is a saturated red.
   */
  readonly chromeRamp?: 'primary' | 'accent' | 'neutral'
  /**
   * The hue that tints every neutral and every shadow. Defaults to the primary
   * hue. Set it when the primary is too saturated to tint greys with — a red
   * brand hue turns the entire interface pink.
   */
  readonly neutralHue?: number
  /**
   * The categorical chart series. Defaults to `DEFAULT_CHART_SLOTS`, which is
   * validated in both themes; overriding means re-running the validator.
   */
  readonly chart?: readonly ChartSlotSpec[]
  readonly logo?: Partial<BrandLogo>
  readonly typography?: Partial<BrandTypography>
  readonly shape?: Partial<BrandShape>
}

/**
 * Font stacks.
 *
 * Arabic is listed as a *separate* token rather than appended to the Latin
 * stack because the two need different fallbacks and different optical sizes;
 * `[lang='ar']` swaps the whole family (§11). The stacks name webfonts first
 * and degrade to system faces, so an offline pilot environment still renders
 * something deliberate.
 */
const DEFAULT_TYPOGRAPHY: BrandTypography = {
  sans: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  arabic:
    "'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Geeza Pro', 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Menlo', 'Consolas', monospace",
  display: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  wordmarkTracking: '0.02em',
  wordmarkWeight: 650,
}

const DEFAULT_SHAPE: BrandShape = {
  radius: 10,
  logoRadius: 0.235,
  borderWidth: 1,
}

const DEFAULT_LOGO: BrandLogo = {
  kind: 'monogram',
  monogramLetter: 'Q',
  showWaves: true,
  favicon: '⚓',
}

export function defineBrand(spec: BrandSpec): Brand {
  const primary = ramp(spec.primary)
  const accent = ramp(spec.accent)
  const neutralHue = spec.neutralHue ?? spec.primary.hue
  const neutral = neutralRamp(neutralHue)
  const chrome = { primary, accent, neutral }[spec.chromeRamp ?? 'primary']
  const themeSpec = {
    primary,
    accent,
    neutral,
    chrome,
    hue: neutralHue,
    primarySpec: spec.primary,
  }

  return {
    identity: spec.identity,
    contact: spec.contact,
    documents: spec.documents,
    logo: { ...DEFAULT_LOGO, ...spec.logo },
    typography: { ...DEFAULT_TYPOGRAPHY, ...spec.typography },
    shape: { ...DEFAULT_SHAPE, ...spec.shape },
    palette: {
      primary,
      accent,
      neutral,
      chart: chartSlots(spec.chart ?? DEFAULT_CHART_SLOTS),
    },
    light: lightTheme(themeSpec),
    dark: darkTheme(themeSpec),
  }
}
