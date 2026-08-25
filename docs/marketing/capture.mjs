/**
 * Product screenshots, taken by a script rather than by hand.
 *
 * Every capture under `assets/screens/` used to be a manual browser session,
 * which is why the set drifted: nobody retakes fifteen images by hand when one
 * card changes, so the marketing PDFs kept showing an interface that had moved
 * on — and, worse, kept showing a client's own brand long after the product
 * had stopped defaulting to it.
 *
 * Run it against a server you have already started:
 *
 *     QABANDI_PILOT_FIXTURES=1 pnpm --filter @qabandi/web dev
 *     node docs/marketing/capture.mjs                  # everything
 *     node docs/marketing/capture.mjs dashboard jobs   # just those
 *
 * Chrome is driven through `playwright-core` with `channel: 'chrome'`, the
 * same way `render.mjs` does it — the installed browser, nothing downloaded,
 * no dependency added for an image build.
 *
 * **It must be a real, unsandboxed Chrome.** The dashboard's map is a lazily
 * loaded `maplibre-gl` chunk, and under a sandboxed browser that chunk comes
 * back 403 while `curl` gets 200 for the same URL. The page renders perfectly
 * with a blank rectangle where the map should be, so the failure is invisible
 * unless you look at the image — which is exactly the kind of thing a script
 * should catch, so `waitForMap` below asserts the canvas exists.
 */

import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const PW = join(REPO, 'node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core')
/*
  Reached by path, the same way `render.mjs` reaches playwright-core, and for
  the same reason: both are already in the tree — sharp arrives with Next — and
  neither is worth a declared dependency for a script that builds pictures.
  The cost is that a version bump breaks the path loudly, which is the failure
  mode to want.
*/
const SHARP = join(REPO, 'node_modules/.pnpm/sharp@0.35.3_@types+node@26.2.0/node_modules/sharp')

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000'
const OUT = join(HERE, 'assets/screens')
/** The landing site takes a different crop of the same product; see `LANDING`. */
const LANDING_OUT = join(REPO, 'apps/landing/public/pic/screens')

/**
 * The marketing site gets WebP; the PDFs keep the PNG.
 *
 * Two consumers with opposite needs. Chromium paginating a document wants the
 * full-resolution original and does not care what it weighs. A visitor on a
 * phone in Kuwait is paying for every byte, and a 2880-wide PNG behind a
 * 1180-wide frame is roughly six times the pixels anyone will see.
 *
 * So the landing copies are resampled to twice their display width and
 * re-encoded, and the PNG under `assets/screens/` stays as the source. Nothing
 * here is precious: delete every `.webp` and this script rebuilds them.
 */
const WEB_WIDTH = 2360
const WEB_QUALITY = 80

/**
 * `localhost`, not `127.0.0.1`.
 *
 * `next dev` checks the origin its chunks are requested from against the host
 * it was started on. Driving the same server through `127.0.0.1` blocks every
 * `/_next/static/…` request, so React never hydrates — and the page still
 * renders, because the HTML is server-rendered. A screenshot taken that way
 * looks right and has no map, no charts and no assistant dock in it. The
 * end-to-end config carries the same warning for the same reason.
 */
const LOCALE_COOKIE = 'qabandi_locale'

/**
 * The full-frame captures: 1440×900 at 2×, which is a laptop at the size a
 * prospect actually opens the product on.
 */
const SHOTS = [
  { name: 'dashboard', path: '/dashboard', map: true },
  { name: 'dashboard-ar', path: '/dashboard', locale: 'ar', map: true },
  { name: 'enquiries', path: '/enquiries' },
  { name: 'enquiries-ar', path: '/enquiries', locale: 'ar' },
  { name: 'enquiry', path: '/enquiries', open: true },
  { name: 'quotes', path: '/quotes' },
  { name: 'jobs', path: '/jobs' },
  { name: 'jobs-ar', path: '/jobs', locale: 'ar' },
  { name: 'job-file', path: '/jobs', open: true },
  { name: 'job-file-ar', path: '/jobs', open: true, locale: 'ar' },
  { name: 'job-file-documents', path: '/jobs', open: true, tab: 'documents' },
  { name: 'consolidations', path: '/consolidations' },
  { name: 'customs', path: '/customs' },
  { name: 'finance', path: '/finance' },
  { name: 'finance-ar', path: '/finance', locale: 'ar' },
  { name: 'payables', path: '/payables' },
  { name: 'rates', path: '/rates' },
  { name: 'assistant', path: '/assistant' },
  { name: 'track-empty', path: '/track' },
]

/**
 * The two captures section 06 of the marketing site lays over each other.
 *
 * A shorter viewport, deliberately: it cuts the dashboard map across the
 * middle and leaves the assistant dock — `fixed bottom-5 end-5` — just below
 * the fold, which is the composition that section is built around. They are
 * also clipped past the sidebar in the *file* rather than in CSS, because the
 * page lays the pair at an offset and a CSS crop would move with it.
 */
const LANDING = [
  { name: 'english', path: '/dashboard', map: true },
  { name: 'arabic', path: '/dashboard', locale: 'ar', map: true },
]

/**
 * The hero frame, and the social card — the same file, because they are the
 * same job: the one image somebody sees before they read a word. Full width
 * with the sidebar left in, unlike everything else here, since the sidebar is
 * most of what says how much product there is.
 */
const HERO = [{ name: 'app-dashboard', path: '/dashboard', map: true }]
const LANDING_VIEWPORT = { width: 1440, height: 820 }
/** The sidebar's width as a fraction of the frame — identical on every screen. */
const SIDEBAR_FRACTION = 0.17

async function main() {
  const only = process.argv.slice(2)
  const pw = await import(pathToFileURL(join(PW, 'index.js')).href)
  const chromium = pw.chromium ?? pw.default.chromium

  mkdirSync(OUT, { recursive: true })
  mkdirSync(LANDING_OUT, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome' })
  let taken = 0

  try {
    for (const shot of SHOTS) {
      if (only.length && !only.includes(shot.name)) continue
      await capture(browser, shot, {
        viewport: { width: 1440, height: 900 },
        out: join(OUT, `${shot.name}.png`),
      })
      taken++
    }

    for (const shot of [...LANDING, ...HERO]) {
      if (only.length && !only.includes(shot.name)) continue
      const isHero = HERO.includes(shot)
      const tmp = join(LANDING_OUT, `${shot.name}.tmp.png`)
      await capture(browser, shot, {
        viewport: isHero ? { width: 1440, height: 900 } : LANDING_VIEWPORT,
        out: tmp,
        clipSidebar: !isHero,
      })
      await toWeb(tmp, join(LANDING_OUT, `${shot.name}.webp`), { remove: true })
      taken++
    }

    /*
      The three card screenshots on the marketing site are the same frames the
      PDFs use, so they are re-encoded from those rather than retaken — one
      capture, two consumers, and no way for the two to disagree about what the
      product looks like.

      Each one twice, because `ar.html` cannot reuse the English capture. The
      card crops the sidebar with `margin-inline-start:-20.5%`, a logical
      property, so on an RTL document it crops the *right* edge — which on an
      English screenshot is content, and leaves the sidebar standing. The
      Arabic capture puts the sidebar on the right, where that crop expects it.
    */
    for (const [source, target] of [
      ['enquiries', 'enquiries'],
      ['jobs', 'jobs'],
      ['finance', 'finance'],
      ['enquiries-ar', 'enquiries-ar'],
      ['jobs-ar', 'jobs-ar'],
      ['finance-ar', 'finance-ar'],
      /*
        And the hero frame in Arabic, under the name `ar.html` asks for. Not a
        separate capture either: `dashboard-ar` is already taken at the hero's
        own viewport with the sidebar left in, which is exactly what the hero
        wants — so the landing copy is a re-encode of that PNG.
      */
      ['dashboard-ar', 'app-dashboard-ar'],
    ]) {
      if (only.length && !only.includes(source)) continue
      await toWeb(join(OUT, `${source}.png`), join(LANDING_OUT, `${target}.webp`))
    }
  } finally {
    await browser.close()
  }

  console.log(`\n${taken} capture${taken === 1 ? '' : 's'}.`)
}

async function capture(browser, shot, { viewport, out, clipSidebar }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    // Kuwait, so a rendered date in an image matches a rendered date in Kuwait.
    timezoneId: 'Asia/Kuwait',
    locale: shot.locale === 'ar' ? 'ar-KW' : 'en-GB',
  })

  const url = new URL(BASE)
  await context.addCookies([
    { name: LOCALE_COOKIE, value: shot.locale ?? 'en', domain: url.hostname, path: '/' },
  ])

  const page = await context.newPage()

  /*
    The development overlay is not part of the product.

    `next dev` mounts a `<nextjs-portal>` that renders a "Rendering…" pill in
    the top-right corner, over the brand mark on an RTL page. It sat in every
    committed screenshot before anyone looked closely. Hidden by stylesheet
    rather than by turning the indicator off in `next.config.ts`, because a
    config change to take a picture is a config change somebody forgets to
    revert. `addInitScript` runs before each document, so it survives the
    navigation the detail shots perform.
  */
  await page.addInitScript(() => {
    const hide = () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal,#__next-build-watcher{display:none !important}'
      document.head?.appendChild(style)
    }
    if (document.head) hide()
    else document.addEventListener('DOMContentLoaded', hide)
  })

  /*
    A console error is not fatal to a screenshot, but it is nearly always the
    reason one looks subtly wrong — a missing translation key renders as the
    key, and the image ships with `dashboard.map.legend` in it. Collected and
    reported rather than thrown on, because a half-broken capture you can see
    beats no capture at all.
  */
  const problems = []
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  page.on('pageerror', (e) => problems.push(String(e)))

  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' })

  if (shot.open) {
    /*
      Read the first row's href and navigate to it, rather than clicking it.

      Clicking looked right and was not: `next dev` routes through the client
      router, `waitForLoadState('networkidle')` resolves against a page that has
      not changed yet, and the capture came out as the register — a board where
      a job file was supposed to be, in every detail shot, silently. Reading the
      href keeps the property that made clicking attractive (the id comes from
      the data, and fixtures and the database do not share ids) and removes the
      race entirely.
    */
    const href = await page
      .locator(`a[href*="${shot.path}/"]`)
      .first()
      .getAttribute('href')
      .catch(() => null)

    if (href) {
      await page.goto(new URL(href, BASE).href, { waitUntil: 'networkidle' })
    } else {
      console.log(`      ⚠ no row to open on ${shot.path} — capturing the register instead`)
    }
  }

  if (shot.tab) {
    const tab = page.getByRole('tab', { name: new RegExp(shot.tab, 'i') }).first()
    if (await tab.count()) {
      await tab.click()
      await page.waitForLoadState('networkidle')
    }
  }

  if (shot.map) await waitForMap(page)

  /*
    Fonts, then a beat.

    `networkidle` fires before the Google Fonts faces have been applied, and a
    capture taken at that moment renders the whole interface in the fallback
    stack — which looks like a font bug in the product rather than a timing bug
    in this script. `document.fonts.ready` is the actual signal; the extra
    settle covers chart and count-up animations.
  */
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(700)

  /*
    The sidebar is on the side the interface starts from, and an Arabic
    interface starts from the right. Taking a fixed 17% off the left crops the
    sidebar out of an English frame and a column of content out of an Arabic
    one — leaving the navigation standing in the one picture whose whole job is
    to show the screen without it. Same width either way, so the pair in
    section 06 of the marketing site stays registered.
  */
  const sidebar = Math.round(viewport.width * SIDEBAR_FRACTION)
  const clip = clipSidebar
    ? {
        x: shot.locale === 'ar' ? 0 : sidebar,
        y: 0,
        width: viewport.width - sidebar,
        height: viewport.height,
      }
    : undefined

  await page.screenshot({ path: out, clip })
  await context.close()

  const flag = problems.length ? `  ⚠ ${problems.length} console error(s)` : ''
  console.log(`  ${out.split('/').slice(-2).join('/')}${flag}`)
  for (const p of problems.slice(0, 3)) console.log(`      ${p.slice(0, 160)}`)
}

/**
 * Wait for the map canvas, and say so when it never arrives.
 *
 * See the header: a sandboxed browser gets a 403 for the `maplibre-gl` chunk
 * and the page renders a blank rectangle without complaining. This turns that
 * into a line in the output instead of an image somebody notices in a PDF.
 */
async function waitForMap(page) {
  try {
    await page.locator('canvas.maplibregl-canvas, .maplibregl-map canvas').first().waitFor({
      state: 'visible',
      timeout: 15_000,
    })
    await page.waitForTimeout(1200)
  } catch {
    console.log('      ⚠ no map canvas — is this a sandboxed browser?')
  }
}

/**
 * Resample and re-encode one capture for the web.
 *
 * `remove` deletes the intermediate PNG — the landing captures have no second
 * consumer, so leaving a full-resolution copy beside the WebP would put four
 * megabytes in the repository that nothing ever serves. The shots that *are*
 * shared with the PDFs are read from `assets/screens/` and left alone.
 */
async function toWeb(from, to, { remove = false } = {}) {
  const sharp = (await import(pathToFileURL(join(SHARP, 'dist/index.mjs')).href)).default
  const { rmSync, statSync } = await import('node:fs')

  await sharp(from)
    .resize({ width: WEB_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEB_QUALITY })
    .toFile(to)

  const before = statSync(from).size
  const after = statSync(to).size
  if (remove) rmSync(from)
  console.log(
    `  ${to.split('/').slice(-2).join('/')}  ${kb(before)} → ${kb(after)}  (−${Math.round((1 - after / before) * 100)}%)`,
  )
}

const kb = (n) => `${Math.round(n / 1024)}kB`

await main()
