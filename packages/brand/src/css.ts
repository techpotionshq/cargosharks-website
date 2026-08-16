/**
 * Brand tokens → CSS custom properties.
 *
 * This is the join between the brand object and Tailwind. `globals.css` maps
 * every `--qb-*` property declared here onto a Tailwind `@theme` entry, so
 * `bg-surface`, `text-brand` and `border-line` are ordinary utilities whose
 * *values* are resolved at run time. Two consequences, both deliberate:
 *
 *   1. Components are written in Tailwind classes. No component carries a
 *      colour literal or an inline style, so the whitelabel guarantee is
 *      structural rather than a convention someone has to remember.
 *   2. Re-branding does not rebuild the CSS. The stylesheet Tailwind compiles
 *      references variables; swapping the brand swaps the variables. An
 *      operator can be re-skinned from the environment.
 *
 * Themes: bare `:root` carries light, `[data-theme='dark']` wins for an
 * explicit choice, and the `prefers-color-scheme` block covers the default
 * "system" state without overriding an explicit light selection.
 */

import type { Brand, ColorScale, ThemeColors } from './types'

const SCALE_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

function scaleVars(name: string, scale: ColorScale): string[] {
  return SCALE_STOPS.map((stop) => `--qb-${name}-${stop}: ${scale[stop]};`)
}

/** Semantic colours. Same names in both themes; different values. */
function themeVars(theme: ThemeColors): string[] {
  return [
    `--qb-canvas: ${theme.canvas};`,
    `--qb-surface: ${theme.surface};`,
    `--qb-surface-raised: ${theme.surfaceRaised};`,
    `--qb-surface-sunken: ${theme.surfaceSunken};`,
    `--qb-chrome: ${theme.chrome};`,
    `--qb-chrome-ink: ${theme.chromeInk};`,
    `--qb-chrome-ink-muted: ${theme.chromeInkMuted};`,
    `--qb-chrome-line: ${theme.chromeLine};`,
    `--qb-ink: ${theme.ink};`,
    `--qb-ink-muted: ${theme.inkMuted};`,
    `--qb-ink-subtle: ${theme.inkSubtle};`,
    `--qb-on-brand: ${theme.onBrand};`,
    `--qb-line: ${theme.line};`,
    `--qb-line-strong: ${theme.lineStrong};`,
    `--qb-brand: ${theme.brand};`,
    `--qb-brand-hover: ${theme.brandHover};`,
    `--qb-brand-soft: ${theme.brandSoft};`,
    `--qb-brand-soft-ink: ${theme.brandSoftInk};`,
    `--qb-accent: ${theme.accent};`,
    `--qb-accent-soft: ${theme.accentSoft};`,
    `--qb-focus: ${theme.focus};`,
    `--qb-shadow-color: ${theme.shadow};`,
    `--qb-positive: ${theme.status.positive};`,
    `--qb-caution: ${theme.status.caution};`,
    `--qb-critical: ${theme.status.critical};`,
    `--qb-info: ${theme.status.info};`,
    `--qb-muted: ${theme.status.muted};`,
    `--qb-positive-soft: ${theme.statusSoft.positive};`,
    `--qb-caution-soft: ${theme.statusSoft.caution};`,
    `--qb-critical-soft: ${theme.statusSoft.critical};`,
    `--qb-info-soft: ${theme.statusSoft.info};`,
    `--qb-muted-soft: ${theme.statusSoft.muted};`,
  ]
}

/** Values that do not change with the theme. */
function staticVars(brand: Brand): string[] {
  return [
    // Validated in both themes, so one set serves both — see `chartSlots`.
    ...brand.palette.chart.map((color, index) => `--qb-chart-${index + 1}: ${color};`),
    ...scaleVars('primary', brand.palette.primary),
    ...scaleVars('accent', brand.palette.accent),
    ...scaleVars('neutral', brand.palette.neutral),
    `--qb-font-sans: ${brand.typography.sans};`,
    `--qb-font-arabic: ${brand.typography.arabic};`,
    `--qb-font-mono: ${brand.typography.mono};`,
    `--qb-font-display: ${brand.typography.display};`,
    `--qb-wordmark-tracking: ${brand.typography.wordmarkTracking};`,
    `--qb-wordmark-weight: ${brand.typography.wordmarkWeight};`,
    `--qb-radius: ${brand.shape.radius}px;`,
    `--qb-radius-sm: ${Math.max(2, brand.shape.radius - 4)}px;`,
    `--qb-radius-lg: ${brand.shape.radius + 6}px;`,
    `--qb-border-width: ${brand.shape.borderWidth}px;`,
  ]
}

function block(selector: string, declarations: string[], indent = '  '): string {
  return `${selector} {\n${declarations.map((d) => indent + d).join('\n')}\n}`
}

/**
 * The complete theme stylesheet for a brand.
 *
 * Injected once in the root layout. It is a few hundred bytes and it is what
 * lets the same compiled Tailwind serve any operator.
 */
export function brandCss(brand: Brand): string {
  return [
    block(':root', [...staticVars(brand), ...themeVars(brand.light)]),
    block(":root[data-theme='dark']", themeVars(brand.dark)),
    `@media (prefers-color-scheme: dark) {\n${block(
      "  :root:not([data-theme='light'])",
      themeVars(brand.dark),
      '    ',
    )}\n}`,
  ].join('\n\n')
}

/**
 * The categorical series, in assignment order.
 *
 * A chart takes slot 1, then 2, then 3, then 4 — never a colour of its own
 * choosing, and never cycled back to slot 1 for a fifth series. Consuming the
 * variables rather than the literals is what keeps a re-skin from having to
 * revisit every chart.
 */
export const CHART_SERIES_VARS = [
  'var(--qb-chart-1)',
  'var(--qb-chart-2)',
  'var(--qb-chart-3)',
  'var(--qb-chart-4)',
] as const
