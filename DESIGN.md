# CargoSharks website: design standard

The rules every page and component on cargosharks.com follows. When a page
disagrees with this file, the page is wrong. When this file is wrong, change
it here first and then the pages.

Reference the rebuild was measured against: supabase.com (`apps/www`,
Apache-2.0) for spacing and section rhythm. Patterns borrowed, not its brand.

## Foundations

**Colour** lives in `src/app/palette.css` and nowhere else; components use
the Tailwind names from `globals.css` (`bg-paper`, `text-ink-dim`,
`border-line`, `bg-void`, `text-blue-ink`, `text-heading`...). shadcn's names
(`bg-primary`, `border-input`, `text-muted-foreground`) point at the same
palette, so a component added with `shadcn add` arrives in our colours.

- Paper is the ground; dark `void` bands are punctuation, used where the
  argument changes register (a photograph, the demurrage clock, the close).
- **Headings on paper are `text-heading`**: the brand navy, weight 800.
  On a dark band they are `text-on-void`.
- Blue is for things you can click. Amber means money is running (demurrage,
  the calculator result) and nothing else. Green is a state ("Live",
  "cleared"), never decoration.

**Type**: one scale, seven steps, nothing under 13px. Use these classes only.

| Class          | Size                | Use                                    |
| -------------- | ------------------- | -------------------------------------- |
| `text-display` | 35–54px, weight 800 | The one H1 per page                    |
| `text-h2`      | 26–37px, weight 800 | Section headings                       |
| `text-h3`      | 18–22px, weight 700 | Card and sub-headings                  |
| `text-lede`    | 18px                | The paragraph under a heading          |
| `text-body`    | 16px                | Running text                           |
| `text-small`   | 14px                | Secondary text, table cells, captions  |
| `text-label`   | 13px                | Field labels, table heads, legal lines |

Manrope for everything in English, IBM Plex Sans Arabic in Arabic, IBM Plex
Mono only for data: amounts, references, container numbers, codes. Never mono
as decoration, and no uppercase tracked "eyebrow" labels above headings.

**Spacing**: every band is a `Section` (`src/components/ui/section.tsx`).

| `space`   | Padding        | When                                        |
| --------- | -------------- | ------------------------------------------- |
| `default` | 64 / 80 / 96px | Sections with a heading and real content    |
| `tight`   | 48 / 56px      | Short sections, link strips, story sections |
| `none`    | 0              | The section draws its own (photo bands)     |

Sections are separated by a hairline (`rule`), not by more air. Inside a
section: 40–48px between the header and the content, 16–24px between
siblings, `gap` rather than margins.

**Containers**: `.shell` (75rem, the text measure, gutters 20–56px) for
everything; `.shell-wide` (84rem) only for a product screenshot that needs to
be legible. Running text is capped at 56–64ch.

## Components

| Component                                        | File               | Use                                                         |
| ------------------------------------------------ | ------------------ | ----------------------------------------------------------- |
| `Section`, `SectionHeader`                       | `ui/section.tsx`   | Every band; heading on the start side, lede on the end side |
| `Button`                                         | `ui/button.tsx`    | `default` (primary), `outline`, `onDark`, `ghost`, `link`   |
| `Badge`                                          | `ui/badge.tsx`     | A state only: `live`, `build`, `outline`, `onDark`          |
| `Table`                                          | `ui/table.tsx`     | Every table; numbers `text-end` + `figures font-mono`       |
| `Reveal`                                         | `Reveal.tsx`       | The only scroll animation                                   |
| `InvoiceExample`, `DecimalsCard`, `FreeTimeCard` | `visuals.tsx`      | Documents drawn as evidence                                 |
| `SolutionPage`                                   | `SolutionPage.tsx` | Every market and job page, from `solutions.ts`              |
| `Header`, `Footer`                               |                    | Shared by every page                                        |

Add new shadcn components with `npx shadcn@latest add <name>`
(`components.json` has `rtl: true`), then check them in Arabic.

## Section shapes

A page is never one template repeated. Each section takes the shape its
content asks for, and adjacent sections differ:

1. **Split**: heading start, body end. The default for prose.
2. **Beside a document**: copy on one side, a drawn document (`visuals.tsx`)
   or a real screenshot on the other; consecutive ones alternate sides.
3. **Dark band**: `bg-void` over a photograph, for the moment the argument
   changes register. At most two per page.
4. **Cards**: four or more parallel points become a row of cards with an
   icon each. Never cards for fewer than three, and never nested cards.
5. **Ledger**: label and value pairs in a `dl` with hairlines, for facts.

Numbered markers (01, 02...) only where the order is information (steps of a
process), never as decoration.

## Motion

Values in `src/lib/motion.ts`; nothing hard-codes its own.

- One scroll effect: `Reveal`, a 12px rise over 0.35s, starting 64px before
  the block enters the screen. No fades from invisible: content is on the
  page before any script runs.
- Hover and colour changes 0.15s. Menus 0.2–0.35s. The hero frame 0.5s.
- Stagger between siblings at most 0.05s.
- Never animate width, height, top or left; transform and opacity only.
- Reduced motion: the same element renders, and a `motion-reduce:` class pins
  it in place. Never branch the rendered element on `useReducedMotion`, which
  the server cannot know.

## Charts and tables

- Every chart has a scale it is drawn to, labelled axes with units, and a
  source or caption. Labels never overlap marks or each other.
- Every figure on a chart or in a table must add up: totals, percentages,
  day counts and dates checked against each other before merge.
- Money is formatted per currency: KWD three decimals, SAR and AED two.
- **Charts use shadcn/ui's chart** (`src/components/ui/chart.tsx`, Recharts
  2.15), not hand-drawn SVG. Recharts 3 is not used: pnpm's trust check
  refuses its dependency `reselect@5.1.1`. Chart components live in
  `src/components/charts/` with `'use client'`; the reference ones are
  `AccrualChart` and `CostShapeChart` in `charts.tsx`.
- **Every figure sits in `ChartFigure`** (`components/charts/ChartFigure.tsx`):
  title on top (navy, `text-h3`), an optional `meta` at the end of the title
  row for the unit or source, the chart, then one caption **centred under the
  chart inside the card**, one or two sentences, under ~160 characters. No
  long paragraph under a figure; that copy belongs to the section.
- **Series colours**: `--color-chart-1` blue (the primary series),
  `--color-chart-2` navy (a comparison or second series; never grey),
  `--color-chart-3` amber (money running only), `-4` green (a state), `-5`
  light blue. Grey is for gridlines, axes and empty ground only.
- **Labels on the plot are short** (an amount, a name); explanations go in the
  caption. A label that would cross a mark moves to the key under the chart.
  Keys sit centred under the chart.
- **Fixed heights** (`aspect-auto h-[300px] sm:h-[340px]` or similar) so the
  page never shifts while a chart measures. `isAnimationActive={false}`: the
  page's motion is `Reveal`, not a chart drawing itself.
- **Arabic**: the chart area is `dir="ltr"` (set by `ChartContainer`), the time
  axis is `reversed` and the value axis `orientation="right"`.
- **Not every figure is a chart.** A list of facts is a two-column ledger
  (`dl` with hairlines), a matrix is `ui/table`, a comparison of two states is
  two cards side by side (the "wrong" one on the dark navy, not a beige or
  grey tint). Never a cloud of small tags or chips.
- A figure that changes with time (days since, amount accrued) is computed
  from one date, never typed.

## Copy

- Lead H1s and titles with the search phrase ("freight forwarding software…").
  Titles ≤ 60 characters, descriptions ≤ 155.
- The offer is: free demo and demo calls, then paid setup and onboarding, then
  a subscription. Never "pilot" or "trial" (in Arabic, never «تجربة» for it).
- ZATCA Phase 2 and UAE e-invoicing are part of the product; never
  "certified" or "approved by ZATCA".
- No em-dash asides, no "X, not Y" slogans, no "honest". Plain sentences.
- Every claim has to be one `scripts/blog/product-facts.md` allows.

## Both languages

Every page has an English and an Arabic twin with the same components and
`dir="rtl"`. Logical properties only (`ms-`, `pe-`, `start-`, `text-end`).
Arrows flip with `rtl:-scale-x-100`. An amount with its currency code is one
left-to-right unit (`dir="ltr"` on the element).

## Responsive

Checked at 390px (phone), 768px (tablet) and 1440px (desktop) before merge:

- No horizontal scroll at any width. Grids that hold tables or long content
  use `grid-cols-1` below their breakpoint (an implicit track grows to its
  widest child) and children get `min-w-0`.
- Tables, and the wide drawn figures (a 1000-unit SVG whose labels would
  fall under 13px if scaled to a phone), scroll sideways inside their own box;
  the page itself never does.
- Touch targets at least 40px tall.

## Verify before merge

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Then load every changed page in both languages at the three widths, with and
without reduced motion, and read the console: no hydration warnings.
