// Screenshots as directives.
//
//   ![Overdue invoices](shot:/invoices?viewport=desktop&locale=en&focus=role=table)
//
// The path is the page; these query keys belong to the shot and are removed
// before the page is opened (anything else stays, so `/reports?dimension=lane`
// works):
//
//   viewport  desktop (1440x900, the default) or phone (390x844)
//   locale    en (default) or ar
//   who       operations (default), customer, agent, or none (signed out)
//   click     a selector to click first, e.g. to open a dialog; repeatable
//   fill      selector=>text to type first; repeatable
//   scroll    a selector to bring near the top of the screen
//   focus     a selector to ring; repeatable
//   mark      n:selector, a numbered ring; repeatable
//   crop      a selector to cut the picture down to (plus a margin)
//   full      1 for the whole page rather than the first screen
//   pdf       1 when the path is a PDF route: shows its first page
//   hide      a selector to leave out of the picture (demo-only furniture); repeatable
//   wait      extra milliseconds before the picture
//
// Selectors are Playwright's: role=button[name="Approve"], text=…,
// [data-guide=…], css. Never coordinates: a coordinate is right for exactly
// one layout, and the point of a directive is that it survives the next one.
//
// A path may name a record by how a reader would find it rather than by id:
// `/jobs/{first:/jobs}` is "the first shipment on the Shipments list". The id
// is looked up on the stack once and cached with the list's own fingerprint.
import { copyFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cached } from '../cache.mjs'
import { CACHE } from '../paths.mjs'
import { filesFingerprint, screen } from '../graph.mjs'
import { BRAND_KEY, colors } from '../brand.mjs'
import { hash, mkdirp, readJson, sh, sleep } from '../util.mjs'
import { context, launch, settle } from '../record/browser.mjs'

const VERSION = 2
const TOOL = ['tools/guide/src/manual/shots.mjs', 'tools/guide/src/record/browser.mjs']
const OWN = [
  'hide',
  'viewport',
  'locale',
  'who',
  'click',
  'fill',
  'scroll',
  'focus',
  'mark',
  'crop',
  'full',
  'pdf',
  'wait',
]

export function parseShot(target) {
  const raw = target.replace(/^shot:/, '')
  const q = raw.indexOf('?')
  const path = q < 0 ? raw : raw.slice(0, q)
  const params = {}
  const pass = []
  if (q >= 0) {
    for (const part of raw.slice(q + 1).split('&')) {
      if (!part) continue
      const i = part.indexOf('=')
      const k = i < 0 ? part : part.slice(0, i)
      const v = i < 0 ? '1' : part.slice(i + 1)
      if (OWN.includes(k)) (params[k] ??= []).push(v)
      else pass.push(part)
    }
  }
  const one = (k, d) => params[k]?.[0] ?? d
  return {
    path: path + (pass.length ? `?${pass.join('&')}` : ''),
    viewport: one('viewport', 'desktop'),
    locale: one('locale', 'en'),
    who: one('who', 'operations') === 'none' ? null : one('who', 'operations'),
    click: params.click ?? [],
    fill: params.fill ?? [],
    scroll: one('scroll'),
    focus: params.focus ?? [],
    mark: params.mark ?? [],
    crop: one('crop'),
    full: one('full') === '1',
    pdf: one('pdf') === '1',
    wait: Number(one('wait', 0)),
    hide: params.hide ?? [],
  }
}

let browser
const pageFor = async (stack, shot) => {
  browser ??= await launch()
  const ctx = await context(browser, stack, {
    who: shot.who,
    locale: shot.locale,
    viewport: shot.viewport,
  })
  return { ctx, page: await ctx.newPage() }
}
export async function closeShots() {
  await browser?.close()
  browser = undefined
}

const resolveMemo = (stackFp, list, fp) =>
  join(mkdirp(join(CACHE, 'resolve')), `${hash([stackFp, list, fp])}.json`)

/**
 * The concrete path a directive resolved to last time, without starting
 * anything (for `guide:stale`). Falls back to the list itself.
 */
export function peekPath(path, locale = 'en', stackFp = 'fixtures@2026-10-14T09:30:00+03:00') {
  const m = path.match(/\{first:([^}]+)\}/)
  if (!m) return path
  const href = readJson(resolveMemo(stackFp, m[1], screen(m[1], locale).fingerprint))?.href
  return href ? path.replace(m[0], href.slice(m[1].split('?')[0].length + 1)) : m[1]
}

/** Replaces `{first:/list}` placeholders with real ids from the stack. */
async function resolvePath(desc, shot) {
  const m = shot.path.match(/\{first:([^}]+)\}/)
  if (!m) return shot.path
  const list = m[1]
  const fp = screen(list, shot.locale).fingerprint
  const memo = resolveMemo(desc.fingerprint({}), list, fp)
  let href = readJson(memo)?.href
  if (!href) {
    const stack = await desc.ensure()
    const { ctx, page } = await pageFor(stack, { ...shot, path: list })
    await page.goto(stack.base + list, { waitUntil: 'networkidle' })
    const base = list.split('?')[0]
    href = await page.evaluate((base) => {
      const a = [...document.querySelectorAll('main a[href]')]
        .map((x) => x.getAttribute('href'))
        .find((h) => h.startsWith(base + '/') && h.length > base.length + 1)
      return a ?? null
    }, base)
    await ctx.close()
    if (!href) throw new Error(`no record link on ${list}`)
    writeFileSync(memo, JSON.stringify({ href }))
  }
  return shot.path.replace(m[0], href.slice(list.split('?')[0].length + 1))
}

async function ring(page, items) {
  const boxes = []
  for (const { n, sel } of items) {
    const bb = await page
      .locator(sel)
      .first()
      .boundingBox()
      .catch(() => null)
    if (!bb) throw new Error(`shot: nothing matches ${sel}`)
    boxes.push({ n, ...bb })
  }
  await page.evaluate(
    ({ boxes, c }) => {
      for (const x of boxes) {
        const o = document.createElement('div')
        o.style.cssText = `position:absolute;left:${Math.max(3, x.x - 6) + scrollX}px;top:${Math.max(3, x.y - 6) + scrollY}px;width:${x.width + 12}px;height:${x.height + 12}px;border:3px solid ${c};border-radius:12px;box-shadow:0 0 0 6px color-mix(in oklch, ${c} 18%, transparent);z-index:2147483646;pointer-events:none`
        document.body.append(o)
        if (x.n) {
          const g = document.createElement('div')
          g.textContent = x.n
          g.style.cssText = `position:absolute;left:${Math.max(6, x.x - 20) + scrollX}px;top:${Math.max(6, x.y - 20) + scrollY}px;width:30px;height:30px;border-radius:50%;background:${c};color:#fff;font:700 16px/30px Inter,sans-serif;text-align:center;z-index:2147483647;box-shadow:0 2px 6px rgba(0,0,0,.3)`
          document.body.append(g)
        }
      }
    },
    { boxes, c: colors.brand },
  )
}

async function take(stack, shot, path, out) {
  const tmp = `${out}.png`
  const { ctx, page } = await pageFor(stack, shot)
  try {
    if (shot.pdf) {
      const res = await ctx.request.get(stack.base + path)
      if (!res.ok()) throw new Error(`shot: ${path} answered ${res.status()}`)
      const dir = mkdirp(`${out}.pdfdir`)
      writeFileSync(join(dir, 'doc.pdf'), await res.body())
      sh('pdftoppm', [
        '-r',
        '130',
        '-png',
        '-f',
        '1',
        '-l',
        '1',
        join(dir, 'doc.pdf'),
        join(dir, 'p'),
      ])
      const png = readdirSync(dir).find((f) => f.endsWith('.png'))
      copyFileSync(join(dir, png), tmp)
      sh('rm', ['-rf', dir])
    } else {
      await page.goto(stack.base + path, { waitUntil: 'networkidle' })
      await settle(page)
      for (const sel of shot.hide)
        await page.locator(sel).evaluateAll((els) => els.forEach((e) => (e.style.display = 'none')))
      for (const f of shot.fill) {
        const [sel, text] = f.split('=>')
        await page.locator(sel).first().fill(text)
      }
      for (const sel of shot.click) {
        await page.locator(sel).first().click()
        await sleep(600)
        await settle(page, { map: false })
      }
      if (shot.scroll) {
        await page
          .locator(shot.scroll)
          .first()
          .evaluate((el) =>
            window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80),
          )
        await sleep(300)
      }
      await ring(page, [
        ...shot.focus.map((sel) => ({ sel })),
        ...shot.mark.map((m) => ({ n: m.split(':')[0], sel: m.slice(m.indexOf(':') + 1) })),
      ])
      if (shot.wait) await sleep(shot.wait)
      let clip
      if (shot.crop) {
        const bb = await page.locator(shot.crop).first().boundingBox()
        const vp = page.viewportSize()
        clip = {
          x: Math.max(0, bb.x - 16),
          y: Math.max(0, bb.y - 16),
          width: Math.min(vp.width, bb.width + 32),
          height: Math.min(vp.height, bb.height + 32),
        }
      }
      await page.screenshot({ path: tmp, fullPage: shot.full, clip })
    }
    const width = shot.viewport === 'phone' ? '780x' : '2000x>'
    sh('convert', [tmp, '-resize', width, '-quality', '86', `jpg:${out}`])
    sh('rm', ['-f', tmp])
  } finally {
    await ctx.close()
  }
}

/**
 * The cached JPEG for a directive. Returns `{ path, key, hit, deps }`; `deps`
 * is the route the picture depends on, for `guide:stale`.
 */
export async function shoot(desc, target) {
  const shot = parseShot(target)
  const path = await resolvePath(desc, shot)
  const scr = screen(path, shot.locale)
  const key = hash({
    v: VERSION,
    shot: { ...shot, path },
    screen: scr.fingerprint,
    stack: desc.fingerprint({}),
    brand: BRAND_KEY,
    tool: filesFingerprint(TOOL),
  })
  const r = await cached('shot', key, '.jpg', async (tmp) =>
    take(await desc.ensure(), shot, path, tmp),
  )
  return { ...r, key, route: scr.route.url, page: path }
}
