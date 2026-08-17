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

  { src: 'sales/one-pager.md', out: 'sales/01-One-Pager.pdf', title: 'Cargolane — One-Pager' },
  { src: 'sales/deck.md', out: 'sales/02-Deck-and-Script.pdf', title: 'The Deck — Slides and Script' },
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

  { src: 'manual/README.md', out: 'manual/00-Manual-Contents.pdf', title: 'User Manual — Contents' },
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
  --accent: #0f4c5c;
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

/* ---- title block ------------------------------------------------------- */

.doc-title {
  border-bottom: 2.5pt solid var(--accent);
  padding-bottom: 7pt;
  margin-bottom: 20pt;
}
.doc-title .eyebrow {
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 7.5pt;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 600;
  margin-bottom: 4pt;
}
.doc-title h1 { font-size: 20pt; margin: 0; border: 0; padding: 0; }

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
  color: #0b3d49;
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
  <span style="letter-spacing:0.04em;">${note ? `<b style="color:#0f4c5c;">${esc(note)}</b>` : esc(title)}</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Markdown to an HTML fragment, through pandoc's GFM reader. */
const toHtml = (abs) =>
  execFileSync('pandoc', [abs, '-f', 'gfm', '-t', 'html5', '--wrap=none'], {
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

const shell = (title, eyebrow, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CSS}</style></head><body>
<div class="doc-title">${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}<h1>${esc(title)}</h1></div>
${body}</body></html>`

const eyebrowFor = (src) =>
  src.startsWith('sales/')
    ? 'Cargolane · Sales'
    : src.startsWith('manual/')
      ? 'Cargolane · User Manual'
      : 'Cargolane'

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

  try {
    for (const doc of DOCS) {
      const body = dropLeadingH1(toHtml(join(SRC, doc.src)))
      const html = join(tmp, doc.out.replace(/[\\/]/g, '_') + '.html')
      writeFileSync(html, shell(doc.title, eyebrowFor(doc.src), body), 'utf8')
      await render(html, join(OUT, doc.out), doc.title, doc.note)
      console.log('  ' + doc.out)
    }

    const parts = BUNDLE.parts
      .map((p, i) => {
        const inner = toHtml(join(SRC, p))
        return `<section class="part">${i === 0 ? dropLeadingH1(inner) : inner}</section>`
      })
      .join('\n')
    const html = join(tmp, 'bundle.html')
    writeFileSync(html, shell(BUNDLE.title, 'Cargolane · User Manual', parts), 'utf8')
    await render(html, join(OUT, BUNDLE.out), BUNDLE.title)
    console.log('  ' + BUNDLE.out)
  } finally {
    await browser.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

await main()
