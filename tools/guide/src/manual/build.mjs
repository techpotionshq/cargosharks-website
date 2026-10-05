// The manual: Markdown sections in, an HTML guide and a PDF out.
//
// One file per section under docs/guide/manual/<locale>/, named NN-slug.md so
// the order is the file order. Each starts with front matter naming what the
// section describes, which is how `guide:stale` knows a section's words may
// need a look when those screens change even where it has no picture:
//
//   ---
//   title: Shipments
//   routes: [/jobs, /jobs/[id]]
//   messages: [jobs.detail.updateStatus]
//   components: [apps/web/src/features/jobs/ui/status-dialog.tsx]
//   ---
//
// Body is pandoc Markdown with three additions: `{app:key}` and `{brand}` (see
// catalog.mjs), screenshot directives (see shots.mjs), and the house blocks as
// fenced divs (::: tip, ::: warn, ::: steps, ::: intro, ::: phone).
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FONT_DIR, GUIDE, OUT } from '../paths.mjs'
import { brand, brandName, colors, markSvg } from '../brand.mjs'
import { expand } from '../catalog.mjs'
import { cached } from '../cache.mjs'
import { hash, log, mkdirp, sh, timer } from '../util.mjs'
import { closeShots, shoot } from './shots.mjs'
import { stackFor } from '../stack/index.mjs'
import { launch } from '../record/browser.mjs'

/** Front matter: `key: value`, `key: [a, b]`, or a `- item` list under a key. Enough YAML for this. */
export function frontMatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { meta: {}, body: src }
  const meta = {}
  let list = null
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && list) {
      meta[list].push(item[1].trim())
      continue
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (!kv) continue
    const [, k, v] = kv
    if (v === '') {
      meta[k] = []
      list = k
    } else if (v.startsWith('[')) {
      meta[k] = v
        .slice(1, -1)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      list = null
    } else {
      meta[k] = v.replace(/^["']|["']$/g, '')
      list = null
    }
  }
  return { meta, body: src.slice(m[0].length) }
}

/** Finds `![alt](shot:…)` with balanced brackets, so selectors may hold () and []. */
export function findShots(md) {
  const out = []
  let i = 0
  while ((i = md.indexOf('](shot:', i)) >= 0) {
    const altStart = md.lastIndexOf('![', i)
    let j = i + 2
    let depth = 1
    let quote = null
    while (j < md.length && depth > 0) {
      const ch = md[j]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
      j++
    }
    out.push({
      start: altStart,
      end: j,
      alt: md.slice(altStart + 2, i),
      target: md.slice(i + 2, j - 1).replace(/^<(.*)>$/, '$1'),
    })
    i = j
  }
  return out
}

export function sections(locale = 'en') {
  const dir = join(GUIDE, 'manual', locale)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^\d+[a-z]?-.*\.md$/.test(f))
    .sort()
    .map((f) => {
      const file = join(dir, f)
      const { meta, body } = frontMatter(readFileSync(file, 'utf8'))
      return { file, id: f.replace(/^\d+[a-z]?-|\.md$/g, ''), meta, body }
    })
}

const pandoc = (md) =>
  sh(
    'pandoc',
    [
      '-f',
      'markdown+fenced_divs+bracketed_spans+implicit_figures-smart',
      '-t',
      'html5',
      '--shift-heading-level-by=1',
      '--wrap=none',
    ],
    { input: md, stdio: ['pipe', 'pipe', 'inherit'] },
  )

function css() {
  const c = colors
  return `
@font-face{font-family:Manrope;font-weight:500;src:url(assets/fonts/manrope-1.ttf)}
@font-face{font-family:Manrope;font-weight:700;src:url(assets/fonts/manrope-2.ttf)}
@font-face{font-family:Manrope;font-weight:800;src:url(assets/fonts/manrope-3.ttf)}
@font-face{font-family:Inter;font-weight:400;src:url(assets/fonts/inter-1.ttf)}
@font-face{font-family:Inter;font-weight:500;src:url(assets/fonts/inter-2.ttf)}
@font-face{font-family:Inter;font-weight:600;src:url(assets/fonts/inter-3.ttf)}
:root{--deep:${c.deep};--brand:${c.brand};--soft:${c.soft};--ink:${brand.light.ink};--muted:${brand.light.inkMuted};--line:${brand.light.line};
  --page:${brand.light.canvas};--card:${brand.light.surface};--sunk:${brand.light.surfaceSunken};--tint:color-mix(in oklch, ${c.brand} 9%, white);
  --warnbg:${brand.light.statusSoft.caution};--warnline:${brand.light.status.caution}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ink:${brand.dark.ink};--muted:${brand.dark.inkMuted};--line:${brand.dark.line};--page:${brand.dark.canvas};--card:${brand.dark.surface};--sunk:${brand.dark.surfaceSunken};--tint:color-mix(in oklch, ${c.brand} 22%, black);--warnbg:${brand.dark.statusSoft.caution};--warnline:${brand.dark.status.caution}}}
:root[data-theme="dark"]{--ink:${brand.dark.ink};--muted:${brand.dark.inkMuted};--line:${brand.dark.line};--page:${brand.dark.canvas};--card:${brand.dark.surface};--sunk:${brand.dark.surfaceSunken};--tint:color-mix(in oklch, ${c.brand} 22%, black);--warnbg:${brand.dark.statusSoft.caution};--warnline:${brand.dark.status.caution}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--page);color:var(--ink);font:400 17px/1.65 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{font-family:Manrope,Inter,sans-serif;letter-spacing:-.015em;line-height:1.2;color:var(--ink)}
h2{font-size:34px;font-weight:800;margin:0 0 10px}h3{font-size:23px;font-weight:800;margin:38px 0 10px}h4{font-size:18px;font-weight:700;margin:26px 0 6px}
p{margin:0 0 14px}a{color:var(--brand)}strong{font-weight:600}
.wrap{max-width:980px;margin:0 auto;padding:0 16px}
.cover{background:radial-gradient(900px 700px at 12% 18%,color-mix(in oklch, ${c.soft} 40%, transparent),transparent 70%),radial-gradient(1100px 800px at 88% 85%,color-mix(in oklch, ${c.bright} 50%, transparent),transparent 70%),linear-gradient(135deg,${c.deep} 0%,${c.mid} 60%,${c.brand} 130%);color:#fff;padding:80px 0 90px;position:relative;overflow:hidden}
.cover .brand{display:flex;align-items:center;gap:14px;font:800 30px Manrope;color:#fff}
.cover h1{color:#fff;font-size:64px;font-weight:800;margin:110px 0 18px;max-width:760px}
.cover .lead{font-size:22px;color:rgba(255,255,255,.85);max-width:640px}
.cover .meta{margin-top:70px;font-size:15px;color:rgba(255,255,255,.7)}
nav.toc{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 32px;margin:-50px auto 40px;position:relative;box-shadow:0 18px 40px rgba(0,0,0,.08)}
nav.toc h2{font-size:22px;margin-bottom:14px}nav.toc ol{margin:0;padding-left:22px;columns:2;column-gap:40px}
nav.toc li{margin:5px 0;break-inside:avoid}nav.toc a{color:var(--ink);text-decoration:none}nav.toc a:hover{color:var(--brand)}
nav.toc .pg{float:right;color:var(--muted);font-variant-numeric:tabular-nums}
section.chapter{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:44px 48px;margin:0 0 34px}
.eyebrow{font:700 13px Manrope;letter-spacing:.16em;text-transform:uppercase;color:var(--brand);margin-bottom:8px}
.intro{font-size:19px;color:var(--muted);margin-bottom:22px}
figure{margin:24px 0 28px}
figure img{width:100%;height:auto;display:block;border-radius:12px;border:1px solid var(--line);box-shadow:0 10px 28px rgba(0,0,0,.08);background:#fff}
figcaption{font-size:14px;color:var(--muted);margin-top:10px}figcaption strong{color:var(--ink)}
.phone{display:flex;gap:24px;justify-content:center;flex-wrap:wrap}.phone figure{width:260px}
.tip,.warn,.note{border-radius:12px;padding:16px 20px;margin:18px 0;border:1px solid var(--line);background:var(--sunk)}
.tip{background:var(--tint);border-color:color-mix(in oklch, ${c.brand} 30%, transparent)}
.warn{background:var(--warnbg);border-color:var(--warnline)}
.tip>p:first-child strong:first-child,.warn>p:first-child strong:first-child{display:block;font-family:Manrope;font-weight:800;margin-bottom:4px}
.tip p:last-child,.warn p:last-child{margin-bottom:0}
.steps ol{counter-reset:s;list-style:none;padding:0;margin:10px 0 18px}
.steps ol>li{counter-increment:s;position:relative;padding:4px 0 10px 46px}
.steps ol>li::before{content:counter(s);position:absolute;left:0;top:2px;width:30px;height:30px;border-radius:50%;background:var(--brand);color:#fff;font:700 15px/30px Manrope;text-align:center}
ul{padding-left:22px}li{margin:4px 0}
table{width:100%;border-collapse:collapse;margin:14px 0 22px;font-size:15px}
th,td{text-align:start;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-family:Manrope;font-weight:700;color:var(--muted);font-size:13px;letter-spacing:.06em;text-transform:uppercase;background:var(--sunk)}
dl dt{font-family:Manrope;font-weight:800;margin-top:14px}dl dd{margin:2px 0 0 0}
.ui{font-weight:600;color:var(--ink);background:var(--sunk);border:1px solid var(--line);border-radius:6px;padding:0 6px;white-space:nowrap}
footer.end{color:var(--muted);text-align:center;padding:30px 0 60px;font-size:14px}
@media (max-width:700px){body{font-size:16px}.cover{padding:50px 0 70px}.cover h1{font-size:40px;margin-top:60px}.cover .lead{font-size:18px}
  nav.toc{padding:20px}nav.toc ol{columns:1}section.chapter{padding:26px 20px}h2{font-size:27px}table{display:block;overflow-x:auto}}
@media print{@page{size:A4;margin:16mm 15mm 18mm}body{background:#fff;font-size:11pt;line-height:1.55}.cover{display:none}
  nav.toc{margin:0;box-shadow:none;border:none;padding:0;break-after:page}nav.toc ol{columns:1}
  section.chapter{border:none;border-radius:0;padding:0;margin:0;break-before:page}
  h2{font-size:24pt}h3{font-size:15pt;break-after:avoid}h4{break-after:avoid}figure{break-inside:avoid}figure img{box-shadow:none}
  .tip,.warn,table{break-inside:avoid}.wrap{max-width:none;padding:0}footer.end{display:none}a{color:var(--ink);text-decoration:none}}
`
}

function page({ title, lead, chapters, locale }) {
  const lockup = `<div class="brand"><span style="color:#fff">${markSvg({ size: 52, variant: 'flat' })}</span>${brandName}</div>`
  return `<!doctype html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The ${brandName} Guide</title>
<style>${css()}</style></head><body>
<header class="cover"><div class="wrap">${lockup}<h1>${title}</h1><p class="lead">${lead}</p><p class="meta">For everyone who uses the system: operations, finance, managers and administrators.</p></div></header>
<main class="wrap">
<nav class="toc"><h2>Contents</h2><ol>${chapters.map((c) => `<li><a href="#${c.id}">${c.title}</a><span class="pg" data-for="${c.id}"></span></li>`).join('')}</ol></nav>
${chapters.map((c, i) => `<section class="chapter" id="${c.id}"><div class="eyebrow">Chapter ${i + 1}</div>\n${c.html}</section>`).join('\n')}
</main><footer class="end">${brand.identity.legalNameEn}</footer></body></html>`
}

async function renderPdf(htmlFile, out, chapters, footerName) {
  const b = await launch()
  const p = await b.newPage()
  const footer = `<div style="width:100%;font:8px Inter,Helvetica,sans-serif;color:#6b7a90;padding:0 15mm;display:flex;justify-content:space-between"><span>${footerName}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
  const opts = {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: footer,
    margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
  }
  await p.goto(`file://${htmlFile}`, { waitUntil: 'networkidle' })
  await p.emulateMedia({ media: 'print', colorScheme: 'light' })
  await p.evaluate(() => document.fonts.ready)
  const body1 = `${out}.body1.pdf`
  await p.pdf({ ...opts, path: body1 })
  // Find the page each chapter starts on by its eyebrow, and write it into the contents.
  const pages = Number(sh('pdfinfo', [body1]).match(/Pages:\s+(\d+)/)[1])
  const found = {}
  for (let n = 1; n <= pages; n++) {
    const txt = sh('pdftotext', ['-f', String(n), '-l', String(n), '-layout', body1, '-'])
    chapters.forEach((c, i) => {
      if (!found[c.id] && new RegExp(`^\\s*CHAPTER ${i + 1}\\s*$`, 'im').test(txt))
        found[c.id] = n + 1
    })
  }
  await p.evaluate((found) => {
    for (const [id, n] of Object.entries(found)) {
      const el = document.querySelector(`.pg[data-for="${id}"]`)
      if (el) el.textContent = n
    }
  }, found)
  const body = `${out}.body.pdf`
  await p.pdf({ ...opts, path: body })
  // The cover is the screen rendering of the header alone, edge to edge.
  await p.emulateMedia({ media: 'screen' })
  await p.addStyleTag({
    content:
      '@page{size:A4;margin:0}main,footer{display:none!important}html,body{margin:0}.cover{height:297mm;padding:40mm 22mm!important}.cover h1{font-size:46pt;margin-top:70mm}.cover .meta{position:absolute;bottom:30mm;margin:0}',
  })
  const cover = `${out}.cover.pdf`
  await p.pdf({
    path: cover,
    format: 'A4',
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    pageRanges: '1',
  })
  await b.close()
  sh('pdfunite', [cover, body, out])
  sh('rm', ['-f', body1, body, cover])
  return pages + 1
}

export async function buildManual({ locales = ['en'], pdf = true, sections: only = [] } = {}) {
  const elapsed = timer()
  const stack = stackFor('fixtures')
  const results = []
  for (const locale of locales) {
    const outDir = mkdirp(join(OUT, 'manual', locale))
    const assets = mkdirp(join(outDir, 'assets'))
    mkdirp(join(assets, 'fonts'))
    for (const f of [
      'manrope-1.ttf',
      'manrope-2.ttf',
      'manrope-3.ttf',
      'inter-1.ttf',
      'inter-2.ttf',
      'inter-3.ttf',
    ])
      if (existsSync(join(FONT_DIR, f))) copyFileSync(join(FONT_DIR, f), join(assets, 'fonts', f))
    const chapters = []
    const failures = []
    let shots = 0
    let made = 0
    for (const s of sections(locale)) {
      if (only.length && !only.some((o) => s.id.startsWith(o) || s.file.includes(o))) continue
      let md = expand(s.body, locale).text
      const found = findShots(md)
      for (const f of found.reverse()) {
        let r
        try {
          r = await shoot(stack, f.target)
        } catch (e) {
          // One broken directive should not cost the other hundred pictures.
          // The page shows where it is, and the build reports it and fails.
          failures.push({ section: s.file, target: f.target, error: e.message.split('\n')[0] })
          md = `${md.slice(0, f.start)}**[Missing picture: ${f.target.replace(/[[\]*_]/g, '')}]**${md.slice(f.end)}`
          continue
        }
        shots++
        if (!r.hit) made++
        copyFileSync(r.path, join(assets, `${r.key}.jpg`))
        md = `${md.slice(0, f.start)}![${f.alt}](assets/${r.key}.jpg)${md.slice(f.end)}`
      }
      const html = pandoc(md)
      const title = s.meta.title ?? md.match(/^#\s+(.+)$/m)?.[1] ?? s.id
      chapters.push({ id: s.id, title: expand(title, locale).text, html })
    }
    await closeShots()
    const html = page({
      title: `The ${brandName} Guide`,
      lead: 'How to run enquiries, quotations, shipments, documents and money in one system, written for the people who use it every day.',
      chapters,
      locale,
    })
    const htmlFile = join(outDir, 'index.html')
    writeFileSync(htmlFile, html)
    let pdfFile = null
    if (pdf && !only.length && !failures.length) {
      const name = `${brandName.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '')}-Guide${locale === 'en' ? '' : `-${locale}`}.pdf`
      const key = hash({ html, v: 1 })
      const r = await cached('pdf', key, '.pdf', (tmp) =>
        renderPdf(htmlFile, tmp, chapters, `The ${brandName} Guide`),
      )
      pdfFile = join(outDir, name)
      copyFileSync(r.path, pdfFile)
    }
    log(
      `manual (${locale}): ${chapters.length} sections, ${shots} shots (${made} new) in ${elapsed().toFixed(1)}s`,
    )
    for (const f of failures) log(`SHOT FAILED in ${f.section}: ${f.target}\n    ${f.error}`)
    results.push({ locale, html: htmlFile, pdf: pdfFile, shots, made, failures })
  }
  return results
}
