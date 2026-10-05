// One way to open the app in a browser, shared by screenshots and recordings.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { RUN, TOOL, chromiumPath } from '../paths.mjs'
import { brand } from '../brand.mjs'
import { mkdirp, sleep } from '../util.mjs'

const require = createRequire(join(TOOL, 'package.json'))
export const { chromium } = require('playwright-core')

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
}

export async function launch() {
  return chromium.launch({
    executablePath: chromiumPath(),
    args: ['--font-render-hinting=none', '--disable-lcd-text'],
  })
}

/** The demo personas, from the same places the product reads them. */
export const PERSONAS = {
  operations: () => brand.demo.operationsEmail,
  customer: () => 'customer@gulfsteel.example',
  agent: () => 'agent@everbright.example',
}

// Next's dev overlay and toasts are not the product.
export const HIDE_CSS =
  'nextjs-portal,[data-nextjs-toast]{display:none!important} *{scroll-behavior:auto!important}'
const HIDE_JS = `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(HIDE_CSS)};
  const add = () => document.head && document.head.appendChild(s); if (document.head) add(); else document.addEventListener('DOMContentLoaded', add) })();`

const statePath = (stack, who) => join(mkdirp(join(RUN, 'sessions')), `${stack.id}-${who}.json`)

/**
 * A browser context on the stack, signed in as `who` (or signed out when null),
 * in `locale`, with the clock pinned where the stack pins it.
 */
export async function context(
  browser,
  stack,
  { who = 'operations', locale = 'en', viewport = 'desktop', scale = 2 } = {},
) {
  const vp = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport
  const phone = viewport === 'phone'
  if (who && !existsSync(statePath(stack, who))) await signIn(browser, stack, who)
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: phone ? 3 : scale,
    isMobile: phone,
    hasTouch: phone,
    storageState: who ? statePath(stack, who) : undefined,
    locale: locale === 'ar' ? 'ar-KW' : 'en-GB',
    timezoneId: 'Asia/Kuwait',
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
  })
  const host = new URL(stack.base).hostname
  await ctx.addCookies([{ name: 'qabandi_locale', value: locale, domain: host, path: '/' }])
  if (stack.now) await ctx.clock.setFixedTime(new Date(stack.now))
  await ctx.addInitScript(HIDE_JS)
  return ctx
}

/** Signs in through the real form, the way a person does. Sessions are kept per stack. */
export async function signIn(browser, stack, who) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS.desktop,
    locale: 'en-GB',
    ignoreHTTPSErrors: true,
  })
  const page = await ctx.newPage()
  await page.goto(`${stack.base}/sign-in`, { waitUntil: 'networkidle' })
  const form = page.locator('form').filter({ has: page.locator('input[name="email"]') })
  await form.locator('input[name="email"]').fill(stack.emails?.[who] ?? PERSONAS[who]())
  await form.locator('input[name="password"]').fill(stack.passwords?.[who] ?? brand.demo.password)
  await form.locator('button[type="submit"]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 })
  if (stack.afterSignIn) await stack.afterSignIn(page, who)
  await sleep(300)
  await ctx.storageState({ path: statePath(stack, who) })
  await ctx.close()
}

/** Waits for the page to stop moving: network idle, fonts loaded, the map drawn if there is one. */
export async function settle(page, { map = true } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  if (map && (await page.locator('canvas.maplibregl-canvas').count())) {
    await page
      .waitForFunction(
        () => {
          const c = document.querySelector('canvas.maplibregl-canvas')
          return c && c.width > 0
        },
        null,
        { timeout: 10000 },
      )
      .catch(() => {})
    await sleep(2000)
  }
  await sleep(400)
}
