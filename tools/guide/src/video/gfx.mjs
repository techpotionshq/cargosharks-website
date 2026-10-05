// Brand graphics for the shorts: the backdrop, the app window's frame and URL
// bars, and the static intro and end cards. Rendered as HTML by Chromium, in
// the branch's brand (name, mark, palette), and cached by what they show.
//
// The cards are static on purpose: an earlier version used ffmpeg's zoompan
// and a drifting background, which stepped in whole pixels and read as shake.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { brand, brandName, colors, hosts, markSvg } from '../brand.mjs'
import { cached } from '../cache.mjs'
import { FONT_DIR } from '../paths.mjs'
import { hash } from '../util.mjs'
import { launch } from '../record/browser.mjs'

const VERSION = 3

function fontFaces() {
  if (!existsSync(FONT_DIR)) return ''
  const have = readdirSync(FONT_DIR)
  const face = (fam, w, f) =>
    have.includes(f)
      ? `@font-face{font-family:${fam};font-weight:${w};src:url(file://${join(FONT_DIR, f)})}`
      : ''
  return [
    face('Manrope', 500, 'manrope-1.ttf'),
    face('Manrope', 700, 'manrope-2.ttf'),
    face('Manrope', 800, 'manrope-3.ttf'),
    face('Inter', 400, 'inter-1.ttf'),
    face('Inter', 500, 'inter-2.ttf'),
    face('Inter', 600, 'inter-3.ttf'),
  ].join('\n')
}
const BASE_CSS = () =>
  `${fontFaces()}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}`

const mix = (c, pct) => `color-mix(in oklch, ${c} ${pct}%, transparent)`
const BG = () => `
  radial-gradient(900px 700px at 12% 18%, ${mix(colors.soft, 38)}, transparent 70%),
  radial-gradient(1100px 800px at 88% 85%, ${mix(colors.bright, 45)}, transparent 70%),
  radial-gradient(700px 600px at 70% 10%, ${mix(colors.soft, 20)}, transparent 70%),
  linear-gradient(135deg, ${colors.deep} 0%, ${colors.mid} 60%, ${colors.brand} 130%)`

const WAVES = (
  w,
  h,
  op = 0.1,
) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0">
  ${Array.from({ length: 7 }, (_, i) => {
    const y = h * (0.52 + i * 0.065)
    const a = 38 + i * 6
    return `<path d="M0 ${y} C ${w * 0.25} ${y - a}, ${w * 0.5} ${y + a}, ${w * 0.75} ${y - a * 0.6} S ${w * 1.1} ${y + a * 0.4}, ${w} ${y}" fill="none" stroke="rgba(255,255,255,${op - i * 0.01})" stroke-width="2"/>`
  }).join('')}
</svg>`

const wordmark = (size = 44) =>
  `<div style="display:flex;align-items:center;gap:${size * 0.4}px;color:#fff">${markSvg({ size: size * 1.4, variant: 'flat' })}<span style="font:800 ${size}px Manrope;letter-spacing:-.01em">${brandName}</span></div>`

let browser
async function page() {
  browser ??= await launch()
  return browser.newPage()
}
export async function closeGfx() {
  await browser?.close()
  browser = undefined
}

async function render(file, html, w, h, transparent = false) {
  const p = await page()
  await p.setViewportSize({ width: w, height: h })
  await p.setContent(
    `<!doctype html><html><head><style>${BASE_CSS()}</style></head><body style="width:${w}px;height:${h}px;overflow:hidden;${transparent ? 'background:transparent' : ''}">${html}</body></html>`,
  )
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(120)
  await p.screenshot({ path: file, omitBackground: transparent, type: 'png' })
  await p.close()
}

const png = async (name, parts, w, h, html, transparent) =>
  (
    await cached('gfx', `${name}-${hash([VERSION, brand.identity.key, parts])}`, '.png', (tmp) =>
      render(tmp, html(), w, h, transparent),
    )
  ).path

/** The window frame: backdrop, shadow, rounded mask for the app, outline. Window at x240 y24, 1440x944. */
export async function frame() {
  return {
    bg: await png(
      'bg',
      [],
      1920,
      1080,
      () => `<div style="position:absolute;inset:0;background:${BG()}"></div>${WAVES(1920, 1080)}`,
    ),
    shadow: await png(
      'shadow',
      [],
      1920,
      1080,
      () =>
        `<div style="position:absolute;left:240px;top:24px;width:1440px;height:944px;border-radius:14px;box-shadow:0 30px 70px rgba(0,0,0,.5),0 8px 22px rgba(0,0,0,.3);background:#000"></div>`,
      true,
    ),
    outline: await png(
      'outline',
      [],
      1920,
      1080,
      () =>
        `<div style="position:absolute;left:240px;top:24px;width:1440px;height:944px;border-radius:14px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)"></div>`,
      true,
    ),
    mask: await png(
      'mask',
      [],
      1440,
      900,
      () =>
        `<div style="position:absolute;inset:0;background:#000"></div><div style="position:absolute;inset:0;background:#fff;border-radius:0 0 14px 14px"></div>`,
    ),
  }
}

/** What the URL bar shows: the brand's own hosts, ids shortened. */
export function displayUrl(url) {
  try {
    const u = new URL(url)
    let path = u.pathname
    const host = path.startsWith('/portal')
      ? hosts.portal
      : path.startsWith('/track')
        ? hosts.track
        : hosts.app
    if (host !== hosts.app) path = path.replace(/^\/(portal|track)/, '') || '/'
    path = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) =>
      m.slice(0, 8),
    )
    return host + (path === '/' ? '' : path)
  } catch {
    return hosts.app
  }
}

export const urlBar = (text) =>
  png(
    'bar',
    [text],
    1440,
    44,
    () => `<div style="position:absolute;inset:0;background:#EEF2F8;border-radius:14px 14px 0 0;border-bottom:1px solid #d9e0ea">
    <div style="position:absolute;left:20px;top:16px;display:flex;gap:9px">${['#F87171', '#FBBF24', '#34D399'].map((c) => `<span style="width:12px;height:12px;border-radius:50%;background:${c};opacity:.85"></span>`).join('')}</div>
    <div style="position:absolute;left:50%;top:8px;transform:translateX(-50%);width:640px;height:28px;border-radius:8px;background:#fff;border:1px solid #dbe2ec;display:flex;align-items:center;justify-content:center;gap:8px;font:500 14px Inter;color:#3b4a5e">
      <svg width="12" height="13" viewBox="0 0 12 13"><rect x="1" y="5.5" width="10" height="7" rx="1.6" fill="#7b8aa0"/><path d="M3.3 5.5V4a2.7 2.7 0 0 1 5.4 0v1.5" stroke="#7b8aa0" stroke-width="1.5" fill="none"/></svg>
      <span>${text}</span></div></div>`,
    true,
  )

export const titleCard = (kicker, title, sub) =>
  png(
    'title',
    [kicker, title, sub],
    1920,
    1080,
    () => `<div style="position:absolute;inset:0;background:${BG()}"></div>${WAVES(1920, 1080)}
    <div style="position:absolute;left:160px;top:140px">${wordmark(40)}</div>
    <div style="position:absolute;left:160px;top:400px;color:#fff;max-width:1500px">
      ${kicker ? `<div style="display:inline-block;font:700 26px Manrope;letter-spacing:.18em;color:${colors.soft};border:2px solid ${mix(colors.soft, 60)};border-radius:999px;padding:8px 22px;margin-bottom:34px">${kicker}</div>` : ''}
      <div style="font:800 96px/1.04 Manrope;letter-spacing:-.02em">${title}</div>
      ${sub ? `<div style="font:500 36px/1.35 Inter;color:rgba(255,255,255,.82);margin-top:28px;max-width:1300px">${sub}</div>` : ''}
    </div>
    <div style="position:absolute;left:160px;bottom:110px;font:500 24px Inter;color:rgba(255,255,255,.6)">The ${brandName} guide</div>`,
  )

export const endCard = () =>
  png(
    'end',
    [],
    1920,
    1080,
    () => `<div style="position:absolute;inset:0;background:${BG()}"></div>${WAVES(1920, 1080)}
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center">
      ${wordmark(64)}
      <div style="font:500 34px Inter;color:rgba(255,255,255,.85);margin-top:30px">${brand.identity.taglineEn}</div>
      <div style="margin-top:110px;font:600 30px Inter;padding:14px 34px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25)">${new URL(brand.contact.websiteUrl).hostname.replace(/^www\./, '')}</div>
    </div>`,
  )

/**
 * The caption box colour as ASS wants it (&HAABBGGRR), painted by the browser
 * so an OKLCH palette value comes out exactly as the screen shows it.
 */
let assMemo
export async function assColor() {
  if (assMemo) return assMemo
  const p = await page()
  const [r, g, b] = await p.evaluate((c) => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const x = cv.getContext('2d')
    x.fillStyle = c
    x.fillRect(0, 0, 1, 1)
    return [...x.getImageData(0, 0, 1, 1).data]
  }, colors.deep)
  await p.close()
  const hx = (n) => n.toString(16).padStart(2, '0').toUpperCase()
  assMemo = `&H3A${hx(b)}${hx(g)}${hx(r)}`
  return assMemo
}
