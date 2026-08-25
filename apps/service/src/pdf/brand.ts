/**
 * The brand, as a printed document consumes it.
 *
 * `renderer.ts` claims a document "inherits the same brand tokens as the
 * interface", and `packages/brand` promises *"the same tokens into PDF
 * letterhead through Chromium. One source, two renderers."* Neither was true:
 * every template opened with a hand-written `:root { --brand:#8c1d18 }`, which
 * is Al-Qabandi's maroon. It stopped being the default brand when the default
 * became CargoSharks, and nothing noticed — so every invoice, bill of lading,
 * delivery order and document kit the product issued printed a stamp and a
 * draft watermark in one client's red, whoever had actually issued it. A hex
 * on a screen is a bug someone reports; a hex on paper leaves the building.
 *
 * The fix is the second renderer doing what the first one does. `brandCss` is
 * the same function `apps/web/src/app/layout.tsx` injects into `<head>`, and
 * Chromium is Chromium, so the tokens resolve identically here.
 */

import { brandCss, resolveBrand } from '@qabandi/brand'

/**
 * Print vocabulary, bound to the brand vocabulary.
 *
 * The templates were written against short local names — `var(--ink)`,
 * `var(--muted)` — and they read better in a print stylesheet than
 * `var(--qb-ink-muted)` does at thirty call sites. Keeping them as aliases
 * means the *mapping decisions* live in one visible place rather than being
 * re-taken every time a rule is added: a document's labels take muted ink, its
 * wash takes the sunken surface, and its accent is the brand's, full stop.
 */
const PRINT_ALIASES = `
  :root {
    --ink: var(--qb-ink);
    --muted: var(--qb-ink-muted);
    --line: var(--qb-line);
    --brand: var(--qb-brand);
    --wash: var(--qb-surface-sunken);
    /*
      A draft watermark is a stain of the brand colour, not a colour of its
      own. It used to be spelled in decimal at twelve per cent alpha, which is
      the same maroon written so that a search for the hex would not find it.
    */
    --brand-wash: color-mix(in srgb, var(--qb-brand) 12%, transparent);
    /* The paper showing through a surrendered stamp. */
    --paper-veil: color-mix(in srgb, var(--qb-surface) 60%, transparent);
  }
`

/**
 * Deliberately *not* the brand's type faces.
 *
 * The templates name `'Noto Sans'`, `'Noto Sans Arabic'` and `'KacstOne'`
 * because those are what the service stage of the Dockerfile installs, and a
 * document is printed by a headless browser with no network and no access to
 * Google Fonts. `--qb-font-sans` asks for Inter, which is correct in a browser
 * and absent in the container. Type is the one token that does not cross.
 */

let cached: string | undefined

/**
 * Resolved on first use, not at import — the same deferral `ai/prompts.ts`
 * documents. `loadEnv()` runs at module scope in `config.ts`, and ESM gives no
 * ordering guarantee between two modules neither of which imports the other,
 * so a `resolveBrand()` evaluated while this file is being imported could read
 * a `BRAND` that `.env` has not set yet and bake the wrong operator into every
 * document for the life of the process. Memoised because a brand with hue
 * overrides rebuilds three colour ramps, and a month-end run is two hundred
 * documents.
 */
export function documentBrandCss(): string {
  return (cached ??= `${brandCss(resolveBrand())}\n${PRINT_ALIASES}`)
}

/**
 * Pinned light, on every document.
 *
 * `brandCss` emits its dark values under `[data-theme='dark']` and under a
 * `prefers-color-scheme: dark` block guarded by `:root:not([data-theme=
 * 'light'])`. Both are right for a screen and catastrophic for A4: a build
 * agent or a container that happens to report a dark colour scheme would print
 * white text on a near-black page, and the first anyone would know is a
 * customer's toner. Stamping the attribute makes the output a property of the
 * brand alone, not of the machine that rendered it.
 */
export const PRINT_THEME_ATTR = `data-theme="light"`
