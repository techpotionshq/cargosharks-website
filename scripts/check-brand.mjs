/**
 * No colour literals outside `packages/brand` — `FR-CP-01`, `NFR-16`.
 *
 * `globals.css` opens with the rule and `packages/brand/src/types.ts` says
 * `pnpm lint:brand` fails the build on a hex in a component. There was no such
 * check. Three files had been carrying `#8c1d18` — Al-Qabandi's maroon — since
 * before the default brand became CargoSharks, and two of them were the *PDF*
 * templates, so every invoice, bill of lading, delivery order and document kit
 * the product issued printed a draft watermark and a surrender stamp in one
 * client's red no matter which operator had issued it. That is the failure
 * mode this rule exists for: a hex on a screen is a bug somebody reports; a hex
 * on A4 leaves the building.
 *
 * The rule, in one sentence: **if it differs between two operators, it is a
 * token in `packages/brand`.** Both renderers read those tokens as `--qb-*`
 * custom properties — Tailwind utilities in `apps/web`, a `<style>` block in
 * `apps/service/src/pdf` — so a re-skin is an environment variable and never a
 * grep.
 *
 * Three things are looked for, and the third is the one that matters:
 *
 *   1. `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`.
 *   2. `oklch(` — the authoring form the palette itself is written in. A
 *      component computing its own OKLCH is doing the palette's job.
 *   3. **A chromatic `rgb()`/`rgba()`.** The draft watermark was spelled
 *      `rgba(140,29,24,.12)`, which is the same maroon in a notation a search
 *      for `8c1d18` does not find. Greys, black, white and transparent pass —
 *      `rgba(0,0,0,0)` is a hit target and `rgb(128,128,128)` is a parse
 *      fallback, neither of which identifies anybody.
 *
 * Text, not a PostCSS or TypeScript plugin: it is a regex over source, it has
 * no toolchain to keep current, and it runs in `pnpm lint` before the tests.
 */

import { globSync, readFileSync } from 'node:fs'

const posix = (f) => f.replaceAll('\\', '/')

/**
 * What ships, and only what ships.
 *
 * `src`, not `public`: artwork is exempt by being artwork.
 * `apps/landing/public/cargosharks-logo/` and `apps/web/public/
 * apple-touch-icon.png` are supplied files with the operator's own colours
 * baked in, and `layout.tsx` already explains why that one raster icon is the
 * single piece of brand-specific artwork on disk. A scan that flagged them
 * would be switched off within a week, and a switched-off check is the state
 * this file was written to get out of.
 *
 * Tests are out for the opposite reason: a regression test's job is to *name*
 * the wrong value — `expect(html).not.toContain('#8c1d18')` is the assertion
 * that keeps this particular maroon from coming back, and a check that forbade
 * writing it would be arguing with itself. Nothing under a `*.test.*` file
 * reaches a customer.
 */
const SOURCES = [
  ...globSync('apps/*/src/**/*.{ts,tsx,css}'),
  ...globSync('packages/*/src/**/*.{ts,tsx,css}'),
]
  .map(posix)
  .filter((f) => !/\.test\.[a-z]+$/.test(f))

/**
 * The allowlist, in two tiers. Every entry is a decision, not an exception.
 */

/**
 * Tier 1 — colour is *defined* here.
 *
 * `packages/brand` is the palette: the ramps, the OKLCH generator, the status
 * hues and the supplied brand artwork (`brands/*-mark.ts` holds the client's
 * own SVG, whose fills are theirs and not ours to tokenise). Flagging this
 * directory would mean flagging the answer.
 */
const DEFINES_COLOUR = [/^packages\/brand\//]

/**
 * Tier 2 — a literal is unavoidable, but it must be **neutral**.
 *
 * `global-error.tsx` is Next's root error boundary. It replaces the whole
 * document, so the layout's `<style id="qb-brand">` was never rendered and
 * `var(--qb-*)` resolves to nothing; Next requires it to be a Client
 * Component, so `getBrand()` — which is `server-only` — cannot be called; and
 * importing `resolveBrand()` would bundle the brand into client JavaScript at
 * build time, which is precisely the property that makes a re-skin cheap. The
 * file's own header sets all three out.
 *
 * So it may hold hex values, and only grey ones. That is the whole distinction
 * the maroon violated: a neutral on the one screen that renders when
 * everything else has failed is defensible, and a specific company's red on
 * that screen is not. Checked rather than trusted, because "it is allowed to
 * have literals" is how the maroon survived a rebrand in the first place.
 */
const NEUTRALS_ONLY = [/^apps\/web\/src\/app\/global-error\.tsx$/]

/** Two channels this far apart is a colour, not a grey. sRGB, 0–255. */
const NEUTRAL_SPREAD = 24

/**
 * Comments are blanked, not deleted.
 *
 * Prose legitimately quotes colours — `globals.css` explains a MapLibre
 * override by naming its `#fff`, and the brand files cite the hexes from the
 * manual they were derived from. Replacing a comment's characters with spaces
 * rather than removing them keeps every line number and column true, which is
 * the half of the message that makes a failure actionable.
 *
 * `//` is only treated as a comment when it is not preceded by a colon, so a
 * `https://` inside a string survives intact and anything hiding after it is
 * still seen.
 */
function blankComments(source) {
  const blank = (m) => m.replace(/[^\n]/g, ' ')
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(
    /(^|[^:])\/\/[^\n]*/g,
    (m, lead) =>
      // The character before `//` is not part of the comment; keep it.
      lead + blank(m.slice(lead.length)),
  )
}

/** Longest form first, so `#101828` is not read as `#101` followed by junk. */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g
const OKLCH = /\boklch\(/g
const RGB = /\brgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[,)/ ]/g

/** `#abc` -> [170, 187, 204]; `#aabbccdd` -> the first three channels. */
function channels(hex) {
  const digits = hex.slice(1)
  const pairs =
    digits.length <= 4
      ? [...digits].slice(0, 3).map((d) => d + d)
      : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)]
  return pairs.map((p) => parseInt(p, 16))
}

const isNeutral = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= NEUTRAL_SPREAD

/** The line a match starts on, counted from the blanked source. */
const lineOf = (source, index) => source.slice(0, index).split('\n').length

/**
 * What to reach for instead, said in the vocabulary of the file's own layer.
 * A message that only says "do not" gets a literal moved rather than removed.
 */
function advice(file) {
  if (file.startsWith('apps/service/src/pdf/')) {
    return (
      '  Documents take their palette from apps/service/src/pdf/brand.ts, which\n' +
      '  prepends brandCss(resolveBrand()) and binds --ink, --muted, --line,\n' +
      '  --brand and --wash to it. Use one of those, or add the mapping there.'
    )
  }
  if (file.startsWith('apps/web/')) {
    return (
      '  Use a token utility — text-ink, bg-surface, border-line, text-brand —\n' +
      '  or var(--qb-*) where a utility will not reach (see lane-map.tsx).\n' +
      '  New semantic colours are added to packages/brand, not to a component.'
    )
  }
  return '  Colour lives in packages/brand and reaches both renderers as --qb-*.'
}

let failures = 0

function report(file, line, found, why) {
  console.error(`${file}:${line}: ${found} — ${why}\n${advice(file)}`)
  failures++
}

for (const file of SOURCES) {
  if (DEFINES_COLOUR.some((p) => p.test(file))) continue

  const neutralsOnly = NEUTRALS_ONLY.some((p) => p.test(file))
  const source = blankComments(readFileSync(file, 'utf8'))

  for (const match of source.matchAll(HEX)) {
    const rgb = channels(match[0])
    if (neutralsOnly && isNeutral(rgb)) continue
    report(
      file,
      lineOf(source, match.index),
      match[0],
      neutralsOnly
        ? `a hex literal that is not neutral (channel spread ${Math.max(...rgb) - Math.min(...rgb)}).`
        : 'a hex colour literal.',
    )
  }

  for (const match of source.matchAll(OKLCH)) {
    report(file, lineOf(source, match.index), 'oklch(', 'a colour computed outside the palette.')
  }

  for (const match of source.matchAll(RGB)) {
    const rgb = match.slice(1, 4).map(Number)
    if (isNeutral(rgb)) continue
    report(
      file,
      lineOf(source, match.index),
      `rgb(${rgb.join(',')})`,
      'a colour literal written in decimal, which a search for the hex misses.',
    )
  }
}

if (failures > 0) {
  console.error(`\n${failures} colour literal(s) outside packages/brand.`)
  process.exit(1)
}

console.log(`brand: ${SOURCES.length} source files, no colour literals outside packages/brand`)
