/**
 * Render the marketing and manual Markdown to print-quality PDF.
 *
 *   node docs/marketing/render.mjs
 *
 * pandoc parses — GFM tables are the part worth not hand-rolling — and Chrome
 * paginates. Chrome is driven through `playwright-core` with
 * `channel: 'chrome'`, so the installed browser is used and nothing is
 * downloaded. `@playwright/test` already brings `playwright-core` into the
 * workspace for the end-to-end run; this reuses it rather than adding a
 * dependency for a document build.
 *
 * Requires pandoc on PATH and Google Chrome installed.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = dirname(fileURLToPath(import.meta.url))
const REPO = join(SRC, '..', '..')
const OUT = join(SRC, 'pdf')
const PW = join(REPO, 'node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core')

/**
 * One entry per document. `note` replaces the footer caption where a document
 * carries a standing warning — internal-only, or figures that are not yet real.
 * It is the cheapest place to put a warning that survives being photocopied.
 */
const DOCS = [
  { src: 'README.md', out: 'Marketing-Set-Overview.pdf', title: 'Marketing and Documentation Set' },

  { src: 'sales/one-pager.md', out: 'sales/01-One-Pager.pdf', title: 'CargoSharks — One-Pager', subtitle: 'The freight platform that answers in minutes, in both languages' },
  { src: 'sales/deck.md', out: 'sales/02-Deck-and-Script.pdf', title: 'The Deck — Slides and Script', subtitle: 'Three moments, told from the screen' },
  {
    src: 'sales/battlecard.md',
    out: 'sales/03-Battlecard.pdf',
    title: 'Competitive Battlecard',
    note: 'INTERNAL — do not circulate',
  },
  {
    src: 'sales/pricing.md',
    out: 'sales/04-Pricing-and-Packaging.pdf',
    title: 'Pricing and Packaging',
    note: 'DRAFT — every figure is a placeholder',
  },
  { src: 'sales/website-copy.md', out: 'sales/05-Website-Copy.pdf', title: 'Website Copy' },
  {
    src: 'sales/kuwait-prospects.md',
    out: 'sales/07-Kuwait-Prospects.pdf',
    title: 'Kuwait Prospect Call Sheet',
    subtitle: 'Fifteen forwarders, ranked — and the two things to settle first',
    note: 'INTERNAL — do not circulate',
  },
  {
    src: 'sales/pilot-term-sheet.md',
    out: 'sales/06-Pilot-Term-Sheet.pdf',
    title: 'Pilot Term Sheet',
    note: 'DRAFT — confirm every figure before this is signed',
  },

  { src: 'manual/README.md', out: 'manual/00-Manual-Contents.pdf', title: 'User Manual — Contents', subtitle: 'A chapter per role — read yours, skim the rest' },
  { src: 'manual/00-orientation.md', out: 'manual/01-Getting-Started.pdf', title: 'Getting Started' },
  { src: 'manual/01-coordinator.md', out: 'manual/02-Coordinator.pdf', title: 'Coordinator' },
  {
    src: 'manual/02-operations-manager.md',
    out: 'manual/03-Operations-Manager.pdf',
    title: 'Operations Manager',
  },
  { src: 'manual/03-sales.md', out: 'manual/04-Sales.pdf', title: 'Sales' },
  { src: 'manual/04-finance.md', out: 'manual/05-Finance.pdf', title: 'Finance' },
  { src: 'manual/05-customs-broker.md', out: 'manual/06-Customs-Broker.pdf', title: 'Customs Broker' },
  { src: 'manual/06-administrator.md', out: 'manual/07-Administrator.pdf', title: 'Administrator' },
  {
    src: 'manual/07-customer-portal.md',
    out: 'manual/08-Tracking-Your-Shipments.pdf',
    title: 'Tracking Your Shipments',
    note: 'For your customers — replace the bracketed tokens first',
  },
  { src: 'manual/08-agent-portal.md', out: 'manual/09-Agents-and-Partners.pdf', title: 'Agents and Partners' },
  {
    src: 'manual/09-permissions-reference.md',
    out: 'manual/10-Who-Can-Do-What.pdf',
    title: 'Who Can Do What',
  },
]

/** The bound manual — every chapter in order, one file, chapters on fresh sheets. */
const BUNDLE = {
  out: 'User-Manual-Complete.pdf',
  title: 'User Manual',
  subtitle: 'Every role, one book — from first sign-in to who can do what',
  parts: [
    'manual/README.md',
    'manual/00-orientation.md',
    'manual/01-coordinator.md',
    'manual/02-operations-manager.md',
    'manual/03-sales.md',
    'manual/04-finance.md',
    'manual/05-customs-broker.md',
    'manual/06-administrator.md',
    'manual/07-customer-portal.md',
    'manual/08-agent-portal.md',
    'manual/09-permissions-reference.md',
  ],
}

/*
  Print CSS.

  Serif body, sans headings — the pairing that survives an office laser printer
  and a desk between two people, which is what a leave-behind is for. Units are
  absolute throughout: a PDF has no viewport for a relative unit to mean
  anything against.
*/
const CSS = `
:root {
  --ink: #16191d;
  --ink-soft: #4a5158;
  --rule: #d9dde1;
  --rule-soft: #eceff1;
  /*
    CargoSharks' own blue, hard-coded on purpose.

    The brand package exists so that an *operator's* documents carry the
    operator's identity. These are not an operator's documents — they are
    CargoSharks' own stationery, sent by CargoSharks, and resolving them from
    whatever BRAND happened to be set would put a client's colours on a
    supplier's sales deck. scripts/check-brand.mjs scopes itself to
    apps and packages source for this reason.

    The 700 stop rather than the 500 the mark is drawn in: --accent colours
    headings, links, rules and table heads, and #1F6FEB at 10pt on white is
    legible on a screen and thin on an office laser. Same hue, four stops
    darker.
  */
  --accent: #0551a7;
  --wash: #f6f8f9;
}

* { box-sizing: border-box; }

body {
  font-family: Cambria, Georgia, "Times New Roman", serif;
  font-size: 10.2pt;
  line-height: 1.52;
  color: var(--ink);
  margin: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ---- title band --------------------------------------------------------- */

.doc-title {
  /*
    Navy at both ends, blue through the middle.

    It ran navy-to-blue, and the mark sits at the right-hand end — so the
    middle fin, which is drawn in #1F6FEB, landed on a #1F6FEB background and
    disappeared. Keeping the band dark where the artwork sits is the fix; the
    blue still reads, it just does it between the title and the mark.
  */
  background: linear-gradient(115deg, #0b2545 0%, #164a8f 52%, #0b2545 100%);
  color: #ffffff;
  border-radius: 5pt;
  padding: 15pt 17pt 14pt;
  margin-bottom: 20pt;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12pt;
}
.doc-title .eyebrow {
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 7.5pt;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.82);
  font-weight: 600;
  margin-bottom: 5pt;
}
.doc-title h1 { font-size: 21pt; margin: 0; border: 0; padding: 0; color: #ffffff; }
.doc-title .subtitle {
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 9.5pt;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 5pt;
}
/* 130:88 is the artwork's own viewBox; forcing a square would squash the fins. */
.doc-mark { width: 46pt; height: 31pt; flex: none; }

/* ---- figures ------------------------------------------------------------ */

figure {
  margin: 13pt 0;
  break-inside: avoid;
  page-break-inside: avoid;
  text-align: center;
}
figure img { max-width: 100%; }

/* A screenshot is a raster and gets a frame; drawn artwork sits on the page.
   Height is capped so one screen never swallows a page of prose. */
figure img[src$=".png"] {
  border: 0.75pt solid var(--rule);
  border-radius: 4pt;
  box-shadow: 0 1.5pt 5pt rgba(22, 25, 29, 0.10);
  max-height: 88mm;
  width: auto;
}

figcaption {
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 8pt;
  color: var(--ink-soft);
  letter-spacing: 0.03em;
  margin-top: 6pt;
}

/* ---- headings ---------------------------------------------------------- */

h1, h2, h3, h4 {
  font-family: "Segoe UI", system-ui, sans-serif;
  color: var(--ink);
  font-weight: 600;
  line-height: 1.22;
  break-after: avoid-page;
  page-break-after: avoid;
}

h1 { font-size: 17pt; margin: 0 0 12pt; letter-spacing: -0.01em; }

h2 {
  font-size: 12.5pt;
  margin: 22pt 0 8pt;
  padding-top: 8pt;
  border-top: 0.75pt solid var(--rule);
  letter-spacing: -0.005em;
}

/*
  A Markdown "---" already draws the separation. Without this, a section break
  followed by a heading prints two rules a few points apart, which reads as a
  rendering fault rather than as emphasis.
*/
hr + h2 { border-top: 0; padding-top: 0; margin-top: 12pt; }

h3 { font-size: 10.8pt; margin: 15pt 0 5pt; color: var(--accent); }

h4 {
  font-size: 9.8pt;
  margin: 12pt 0 4pt;
  color: var(--ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* A chapter inside the bound manual starts on a fresh sheet. */
.part { break-before: page; page-break-before: always; }
.part:first-of-type { break-before: auto; page-break-before: auto; }

/* ---- text -------------------------------------------------------------- */

p { margin: 0 0 8pt; orphans: 3; widows: 3; }

strong { font-weight: 700; color: var(--ink); }
em { font-style: italic; }
a { color: var(--accent); text-decoration: none; }

hr { border: 0; border-top: 0.75pt solid var(--rule); margin: 16pt 0; }

ul, ol { margin: 0 0 9pt; padding-inline-start: 16pt; }
li { margin-bottom: 3.5pt; }
li > ul, li > ol { margin-top: 3.5pt; }

blockquote {
  margin: 11pt 0;
  padding: 7pt 0 7pt 11pt;
  border-inline-start: 2.5pt solid var(--accent);
  background: var(--wash);
  color: var(--ink-soft);
  break-inside: avoid;
  page-break-inside: avoid;
}
blockquote p:last-child { margin-bottom: 0; }

code {
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 0.86em;
  background: var(--wash);
  border: 0.5pt solid var(--rule-soft);
  border-radius: 2pt;
  padding: 0.5pt 3pt;
  color: #0b2545;
}

pre {
  background: var(--wash);
  border: 0.5pt solid var(--rule);
  border-inline-start: 2.5pt solid var(--accent);
  border-radius: 2pt;
  padding: 8pt 10pt;
  white-space: pre-wrap;
  word-break: break-word;
  break-inside: avoid;
  page-break-inside: avoid;
  margin: 10pt 0;
}
pre code { background: none; border: 0; padding: 0; font-size: 8.4pt; line-height: 1.42; }

/* ---- tables ------------------------------------------------------------ */

table {
  width: 100%;
  border-collapse: collapse;
  margin: 11pt 0;
  font-size: 9.1pt;
  font-family: "Segoe UI", system-ui, sans-serif;
  line-height: 1.4;
}

/* Repeat the header row where a long table crosses a page. */
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }

th {
  text-align: start;
  font-weight: 600;
  font-size: 8.2pt;
  letter-spacing: 0.045em;
  text-transform: uppercase;
  color: var(--accent);
  border-bottom: 1.25pt solid var(--accent);
  padding: 5pt 7pt 4pt;
  vertical-align: bottom;
}

td { border-bottom: 0.5pt solid var(--rule-soft); padding: 5pt 7pt; vertical-align: top; }

tbody tr:nth-child(even) { background: #fafbfc; }

th[align="center"], td[align="center"] { text-align: center; }
th[align="right"],  td[align="right"]  { text-align: end; }

/* An empty header cell must still hold its column open. */
th:empty::after { content: "\\00a0"; }
`

/* Chrome renders these into the page margin, where nothing is inherited. */
const footerTemplate = (title, note) => `
<div style="width:100%;font-family:'Segoe UI',system-ui,sans-serif;font-size:7pt;
            color:#767d85;padding:4pt 18mm 0;display:flex;justify-content:space-between;
            align-items:baseline;border-top:0.5pt solid #d9dde1;">
  <span style="letter-spacing:0.04em;">${note ? `<b style="color:#0551a7;">${esc(note)}</b>` : esc(title)}</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Markdown to an HTML fragment, through pandoc's GFM reader. */
const toHtml = (abs) =>
  execFileSync('pandoc', [abs, '-f', 'gfm+implicit_figures', '-t', 'html5', '--wrap=none'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

/**
 * Drop the leading `# Heading`.
 *
 * The rendered title block already carries it, and a document that opens with
 * its own name twice reads as a mistake rather than as emphasis.
 */
const dropLeadingH1 = (html) => html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/, '')

/*
  The assembled HTML lives in a temp directory, so a relative image path in the
  Markdown would resolve against the wrong place. `base` points Chrome back at
  the *source* file's directory, and the paths resolve exactly as the author
  wrote them.
*/
const shell = (title, eyebrow, body, baseDir, subtitle) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<base href="${pathToFileURL(baseDir + '/').href}">
<style>${CSS}</style></head><body>
<div class="doc-title">
  <div class="doc-title-text">
    ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
  </div>
  ${WAVES}
</div>
${body}</body></html>`

/*
  The mark on the title band — the supplied CargoSharks artwork, not a drawing.

  It used to be three route lines and three dots: a placeholder from before the
  product had a mark, which then sat on the cover of every document sent to a
  prospect. The fins are `apps/landing/public/cargosharks-logo/svg/
  cargosharks-mark-dark.svg`, copied rather than read at run time because this
  script has no bundler and a document build that reaches across the repo for
  an asset is a document build that breaks when the asset moves.

  The `-dark` variant: the band behind it is navy, so the largest fin is the
  white one. Decorative, so it is hidden from assistive technology.
*/
const WAVES = `<svg class="doc-mark" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="-4 4 130 88"><path d="M83.25 86.00 L121.81 86.00 L121.86 85.84 L119.49 82.89 L117.24 79.69 L115.11 76.23 L113.11 72.55 L111.22 68.64 L109.29 64.12 L107.66 59.81 L106.00 54.89 L104.63 50.25 L103.26 45.00 L102.03 39.62 L100.95 34.12 L100.10 29.04 L99.30 23.39 L98.59 17.16 L98.03 10.37 L97.91 10.11 L90.71 18.97 L83.00 28.14 L75.20 37.12 L67.65 45.54 L68.82 51.89 L70.19 57.77 L71.81 63.39 L73.68 68.69 L75.65 73.34 L77.69 77.34 L78.99 79.56 L80.36 81.63 L81.79 83.55 L83.41 85.46Z" fill="#FFFFFF"/><path d="M42.90 86.00 L81.42 86.00 L81.46 85.88 L79.58 83.54 L77.82 80.97 L76.45 78.71 L75.02 76.04 L73.67 73.21 L72.41 70.24 L71.23 67.14 L70.04 63.60 L69.05 60.26 L68.06 56.48 L67.18 52.61 L66.40 48.65 L65.79 44.99 L65.21 40.92 L64.71 36.43 L64.30 31.55 L64.21 31.36 L56.87 40.33 L49.34 49.14 L41.74 57.62 L34.35 65.50 L35.09 68.76 L35.94 71.85 L36.91 74.77 L37.94 77.33 L38.98 79.55 L40.11 81.58 L41.50 83.65 L43.05 85.51Z" fill="#1F6FEB"/><path d="M0.84 86.00 L3.90 83.42 L7.32 80.30 L11.07 76.65 L14.96 72.64 L18.93 68.35 L23.08 63.68 L27.18 58.86 L31.04 54.13 L31.62 59.70 L32.32 64.21 L33.29 68.78 L34.44 72.93 L35.82 76.81 L37.34 80.19 L38.98 83.07 L40.01 84.57 L41.10 85.93 L41.08 86.00Z" fill="#79B0FF"/></svg>`

const eyebrowFor = (src) =>
  src.startsWith('sales/')
    ? 'CargoSharks · Sales'
    : src.startsWith('manual/')
      ? 'CargoSharks · User Manual'
      : 'CargoSharks'

async function main() {
  /* playwright-core is CommonJS; under ESM its exports hang off `default`. */
  const pw = await import(pathToFileURL(join(PW, 'index.js')).href)
  const chromium = pw.chromium ?? pw.default.chromium

  const tmp = mkdtempSync(join(tmpdir(), 'qabandi-docs-'))
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()

  const render = async (htmlPath, outPath, title, note) => {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    await page.emulateMedia({ media: 'print' })
    mkdirSync(dirname(outPath), { recursive: true })
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="height:0"></div>',
      footerTemplate: footerTemplate(title, note),
      margin: { top: '16mm', bottom: '18mm', left: '18mm', right: '18mm' },
    })
  }

  /*
    An optional substring filter. Rendering the whole set costs a browser launch
    plus twenty paginations; while iterating on one document that is the whole
    wait. `node render.mjs term-sheet` matches against src and out.
  */
  const only = process.argv[2]
  const wanted = only ? DOCS.filter((d) => d.src.includes(only) || d.out.includes(only)) : DOCS

  try {
    for (const doc of wanted) {
      const body = dropLeadingH1(toHtml(join(SRC, doc.src)))
      const html = join(tmp, doc.out.replace(/[\\/]/g, '_') + '.html')
      writeFileSync(
        html,
        shell(doc.title, eyebrowFor(doc.src), body, join(SRC, dirname(doc.src)), doc.subtitle),
        'utf8',
      )
      await render(html, join(OUT, doc.out), doc.title, doc.note)
      console.log('  ' + doc.out)
    }

    if (only) return

    const parts = BUNDLE.parts
      .map((p, i) => {
        const inner = toHtml(join(SRC, p))
        return `<section class="part">${i === 0 ? dropLeadingH1(inner) : inner}</section>`
      })
      .join('\n')
    const html = join(tmp, 'bundle.html')
    writeFileSync(
      html,
      shell(BUNDLE.title, 'CargoSharks · User Manual', parts, join(SRC, 'manual'), BUNDLE.subtitle),
      'utf8',
    )
    await render(html, join(OUT, BUNDLE.out), BUNDLE.title)
    console.log('  ' + BUNDLE.out)
  } finally {
    await browser.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

await main()
