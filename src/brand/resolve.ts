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
import type { Brand } from './types'

export const BRANDS: Record<string, Brand> = {
  cargosharks: cargosharksBrand,
}

/**
 * The brand an unset `BRAND` resolves to, where an unset `BRAND` is allowed.
 *
 * One trunk carries every brand pack, so this is no longer the line that
 * tells two branches apart; it is only what a developer's machine, a test run
 * and a fixture run wear when nobody named a brand. It is the product's own
 * identity rather than a client's, because an unconfigured environment used to
 * put a live client's name and red into every screenshot and sample PDF.
 *
 * A production deployment with a real database may not lean on it at all:
 * `deploymentBrandProblem` below makes an unset `BRAND` a refusal to boot
 * there (docs/Single_Branch.md).
 */
export const DEFAULT_BRAND_KEY = 'cargosharks'

/**
 * The brand a `BRAND` value names, or a refusal.
 *
 * This used to be `BRANDS[key] ?? cargosharksBrand`, and that fallback is the
 * whole reason the function exists now. An unregistered key is almost always a
 * client whose brand file was never written — `tenant:new --brand acme` with
 * no `brands/acme.ts` — and falling back silently meant the deployment
 * started, worked, and wore *the supplier's* identity on every screen, every
 * emailed notification and every invoice that left the building. Nobody
 * reports a product that looks fine. They report it months later, from a
 * customer.
 *
 * So an unrecognised key stops the process. Both applications resolve the
 * brand at module scope, which makes this a refusal to boot with a readable
 * reason — the kind of failure a deployment checklist can actually catch.
 *
 * An *unset* `BRAND` resolves to `DEFAULT_BRAND_KEY` here: that is a laptop,
 * a test run or a fixture run, and none of those is a client. Whether this
 * environment is allowed to leave it unset is `deploymentBrandProblem`'s
 * question, asked once at boot, not this function's.
 */
function registered(key: string | undefined): Brand {
  if (key === undefined) return BRANDS[DEFAULT_BRAND_KEY] ?? cargosharksBrand

  const brand = BRANDS[key]
  if (brand === undefined) {
    throw new Error(
      `BRAND="${key}" is not a registered brand. ` +
        `Known: ${Object.keys(BRANDS).sort().join(', ')}.\n` +
        'Add src/brand/brands/<key>.ts and register it in BRANDS above. ' +
        'pnpm brand:new --key <key> --name-en "<name>" --primary "#rrggbb" writes both.',
    )
  }
  return brand
}

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
 * Why this environment may not start with the brand it has, or `undefined`.
 *
 * With two product branches the brand came from the branch: `qabandi` defaulted
 * to Al-Qabandi and `main` to CargoSharks, and a lint check kept each branch
 * wearing its own. With one trunk the image is the same for every deployment,
 * so the brand has to come from the deployment, and an unset `BRAND` on a
 * client's server would quietly wear the supplier's identity on every screen,
 * email and invoice (NFR-16). So production refuses to boot without one.
 *
 * Production is `NODE_ENV=production`. Two cases are exempt, both because no
 * client's customer can see them: `next build`, which runs as production and
 * serves nobody, and the pilot fixtures (`QABANDI_PILOT_FIXTURES=1`), which is
 * the demo, the e2e suite, the guide recorder and the marketing captures, none
 * of which has a database or a client. The hosted demo still sets
 * `BRAND=cargosharks` explicitly; the exemption is for the runs that cannot.
 *
 * Returned rather than thrown so each application can report it alongside its
 * other boot problems. An unregistered key is not this function's concern:
 * `resolveBrand` already refuses it everywhere, production or not.
 */
export function deploymentBrandProblem(env: Env = ambientEnv()): string | undefined {
  if (env.NODE_ENV !== 'production') return undefined
  if (env.NEXT_PHASE === 'phase-production-build') return undefined
  if (env.QABANDI_PILOT_FIXTURES === '1') return undefined
  if (str(env, 'BRAND') !== undefined) return undefined
  return (
    'BRAND is unset. Every deployment of the one trunk image names the brand it ' +
    `wears: BRAND=<key>, one of ${Object.keys(BRANDS).sort().join(', ')}. ` +
    `Falling back to '${DEFAULT_BRAND_KEY}' would put the supplier's name on a ` +
    "client's screens, emails and invoices. See docs/Single_Branch.md."
  )
}

/** `deploymentBrandProblem`, as a refusal. For a process with no list to add it to. */
export function requireDeploymentBrand(env: Env = ambientEnv()): void {
  const problem = deploymentBrandProblem(env)
  if (problem !== undefined) throw new Error(`Refusing to start: ${problem}`)
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
  const base = registered(str(env, 'BRAND'))

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
    demo: base.demo,
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
