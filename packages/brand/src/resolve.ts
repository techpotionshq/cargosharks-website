/**
 * Brand resolution.
 *
 * Two levels, in order of how much a client is changing:
 *
 *   1. **A registered brand** — `BRAND=qabandi`. A second operator adds one
 *      file under `brands/` and registers it. This is the intended path, and
 *      `qabandi` is the worked example of it: a real identity, a red primary
 *      and a navy chrome, arrived at without touching `apps/web`.
 *   2. **Environment overrides** — `BRAND_PRIMARY_HUE=210`. For a pilot that
 *      needs re-skinning between two meetings on the same afternoon, and for
 *      preview deployments that should not look like production.
 *
 * Resolution happens on the server, once per request, and the result is
 * injected as CSS custom properties. Nothing brand-related is bundled into
 * client JavaScript, so a re-skin never requires a rebuild.
 */

import { defineBrand } from './define'
import { cargosharksBrand } from './brands/cargosharks'
import { qabandiBrand } from './brands/qabandi'
import type { Brand } from './types'

export const BRANDS: Record<string, Brand> = {
  cargosharks: cargosharksBrand,
  qabandi: qabandiBrand,
}

/**
 * The product's own brand, not a client's.
 *
 * An unconfigured environment — a demo, a preview deployment, a developer's
 * machine, the fixture run every screenshot is taken from — used to default to
 * a live client's identity, which put their name and their red into every
 * image and every sample PDF the product produced. The default is now the
 * thing that owns the product; a client is `BRAND=<key>` and one file.
 */
export const DEFAULT_BRAND_KEY = 'cargosharks'

type Env = Record<string, string | undefined>

/**
 * The ambient environment, read defensively.
 *
 * The package deliberately declares no runtime dependency on Node: it is also
 * evaluated inside the PDF renderer, and a bare `process.env` reference would
 * make it unimportable anywhere that has no `process`.
 */
function ambientEnv(): Env {
  return (globalThis as { process?: { env?: Env } }).process?.env ?? {}
}

function num(env: Env, key: string): number | undefined {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function str(env: Env, key: string): string | undefined {
  const raw = env[key]
  return raw === undefined || raw.trim() === '' ? undefined : raw
}

/**
 * The brand for this deployment.
 *
 * Rebuilt through `defineBrand` when a hue is overridden rather than patched,
 * because a hue change has to propagate through both themes, all three ramps
 * and the logo — patching the resolved object would recolour the buttons and
 * leave the sidebar behind.
 */
export function resolveBrand(env: Env = ambientEnv()): Brand {
  const base = BRANDS[str(env, 'BRAND') ?? DEFAULT_BRAND_KEY] ?? cargosharksBrand

  const primaryHue = num(env, 'BRAND_PRIMARY_HUE')
  const primaryChroma = num(env, 'BRAND_PRIMARY_CHROMA')
  const accentHue = num(env, 'BRAND_ACCENT_HUE')
  const accentChroma = num(env, 'BRAND_ACCENT_CHROMA')
  const radius = num(env, 'BRAND_RADIUS')

  const identity = {
    ...base.identity,
    nameEn: str(env, 'BRAND_NAME_EN') ?? base.identity.nameEn,
    nameAr: str(env, 'BRAND_NAME_AR') ?? base.identity.nameAr,
    legalNameEn: str(env, 'BRAND_LEGAL_NAME_EN') ?? base.identity.legalNameEn,
    shortName: str(env, 'BRAND_SHORT_NAME') ?? base.identity.shortName,
    taglineEn: str(env, 'BRAND_TAGLINE_EN') ?? base.identity.taglineEn,
    taglineAr: str(env, 'BRAND_TAGLINE_AR') ?? base.identity.taglineAr,
  }

  const contact = {
    ...base.contact,
    websiteUrl: str(env, 'BRAND_WEBSITE_URL') ?? base.contact.websiteUrl,
    trackingUrl: str(env, 'BRAND_TRACKING_URL') ?? base.contact.trackingUrl,
    supportEmail: str(env, 'BRAND_SUPPORT_EMAIL') ?? base.contact.supportEmail,
    supportPhone: str(env, 'BRAND_SUPPORT_PHONE') ?? base.contact.supportPhone,
  }

  const logo = {
    ...base.logo,
    monogramLetter: str(env, 'BRAND_MONOGRAM') ?? base.logo.monogramLetter,
    customSvg: str(env, 'BRAND_LOGO_SVG') ?? base.logo.customSvg,
    kind: (str(env, 'BRAND_LOGO_SVG') ? 'custom' : base.logo.kind) as Brand['logo']['kind'],
  }

  const chromeRamp = str(env, 'BRAND_CHROME_RAMP') as 'primary' | 'accent' | 'neutral' | undefined
  const neutralHue = num(env, 'BRAND_NEUTRAL_HUE')

  const needsRebuild =
    primaryHue !== undefined ||
    primaryChroma !== undefined ||
    accentHue !== undefined ||
    accentChroma !== undefined ||
    chromeRamp !== undefined ||
    neutralHue !== undefined

  if (!needsRebuild) {
    return {
      ...base,
      identity,
      contact,
      logo,
      shape: radius === undefined ? base.shape : { ...base.shape, radius },
    }
  }

  return defineBrand({
    identity,
    contact,
    documents: base.documents,
    primary: {
      hue: primaryHue ?? hueOf(base.palette.primary[500]),
      chroma: primaryChroma ?? chromaOf(base.palette.primary[500]),
    },
    accent: {
      hue: accentHue ?? hueOf(base.palette.accent[500]),
      chroma: accentChroma ?? chromaOf(base.palette.accent[500]),
    },
    /**
     * Both of these have to be carried across explicitly. They are not
     * recoverable from the resolved ramps, and letting them fall back to their
     * defaults would mean that overriding one hue silently returns the sidebar
     * to the primary ramp — which for `qabandi`, the case that found this, is
     * a red one.
     */
    chromeRamp: chromeRamp ?? rampOf(base),
    neutralHue: neutralHue ?? hueOf(base.palette.neutral[500]),
    logo,
    typography: base.typography,
    shape: radius === undefined ? base.shape : { ...base.shape, radius },
  })
}

/** Which ramp the resolved brand's chrome was cut from, by matching its value. */
function rampOf(base: Brand): 'primary' | 'accent' | 'neutral' {
  if (base.light.chrome === base.palette.accent[950]) return 'accent'
  if (base.light.chrome === base.palette.neutral[950]) return 'neutral'
  return 'primary'
}

/** `oklch(L C H)` → H. Used only to inherit half of an override. */
function hueOf(color: string): number {
  return Number(/oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/.exec(color)?.[1] ?? 250)
}

function chromaOf(color: string): number {
  return Number(/oklch\(\s*[\d.]+\s+([\d.]+)/.exec(color)?.[1] ?? 0.12)
}
