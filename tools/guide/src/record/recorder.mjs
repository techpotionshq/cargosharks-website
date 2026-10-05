// Recording: a CDP screencast to numbered JPEGs, a visible cursor, human-paced input.
//
// Frames arrive at a variable rate (Chromium only sends one when something
// changed), each stamped with its time; frames.mjs turns them into a steady
// 30 fps video later. Time is the recorder's own clock, started at the first
// frame, and every mark, cut and annotation check is in that clock.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { context, launch } from './browser.mjs'
import { colors } from '../brand.mjs'
import { sleep } from '../util.mjs'

export const CURSOR_JS = `
(() => {
  if (window.__cursorInstalled) return; window.__cursorInstalled = true;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__guide_cursor';
    c.setAttribute('popover', 'manual');
    c.style.cssText = 'all:unset;position:fixed;inset:auto;left:0;top:0;width:28px;height:28px;margin:0;padding:0;border:0;background:transparent;pointer-events:none;z-index:2147483647;overflow:visible;transform:translate(' + (window.__cx||720) + 'px,' + (window.__cy||450) + 'px);transition:none;';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28" style="position:absolute;left:-4px;top:-3px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><path d="M5 3 L5 22 L10 17.5 L13.6 25 L17 23.4 L13.5 16 L20 16 Z" fill="${colors.deep}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    try { c.showPopover(); } catch (e) {}
    // A dialog opened after the cursor joins the top layer above it; re-show the cursor on top.
    const bump = () => { try { c.hidePopover(); c.showPopover(); } catch (e) {} };
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes' && m.attributeName === 'open' && m.target.tagName === 'DIALOG') { bump(); return }
        if (m.type === 'childList') for (const n of m.addedNodes) if (n.nodeType === 1 && (n.tagName === 'DIALOG' || n.querySelector?.('dialog'))) { setTimeout(bump, 30); return }
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true });
    document.addEventListener('toggle', bump, true);
    window.addEventListener('mousemove', (e) => { window.__cx = e.clientX; window.__cy = e.clientY; c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    window.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.setAttribute('popover', 'manual');
      r.style.cssText = 'all:unset;position:fixed;inset:auto;left:' + (e.clientX - 22) + 'px;top:' + (e.clientY - 22) + 'px;width:44px;height:44px;margin:0;border-radius:50%;background:color-mix(in oklch, ${colors.brand} 28%, transparent);border:2px solid color-mix(in oklch, ${colors.brand} 75%, transparent);pointer-events:none;transform:scale(.3);opacity:1;transition:transform .5s cubic-bezier(.2,.7,.3,1),opacity .55s ease-out;';
      document.documentElement.appendChild(r);
      try { r.showPopover(); } catch (e) {}
      bump();
      requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transform = 'scale(1.25)'; r.style.opacity = '0'; }));
      setTimeout(() => r.remove(), 700);
    }, true);
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install);
})();
`

export class Recorder {
  /**
   * @param {string} dir   where frames and meta.json go
   * @param {object} stack the running stack ({ base, ... })
   */
  constructor(
    dir,
    stack,
    { who = 'operations', locale = 'en', viewport = { width: 1440, height: 900 }, scale = 2 } = {},
  ) {
    this.dir = dir
    this.stack = stack
    this.who = who
    this.locale = locale
    this.viewport = viewport
    this.scale = scale
    this.frames = []
    this.marks = []
    this.holds = []
    this.urls = []
    this.cuts = []
    this.initScripts = [CURSOR_JS]
    this.mx = viewport.width / 2
    this.my = viewport.height / 2
  }

  get base() {
    return this.stack.base
  }

  async start() {
    rmSync(this.dir, { recursive: true, force: true })
    mkdirSync(`${this.dir}/f`, { recursive: true })
    this.browser = await launch()
    await this.open(this.who)
  }

  /** Switches persona (or signs out with null), keeping one continuous recording. */
  async open(who, { locale = this.locale } = {}) {
    if (this.ctx) {
      await this.stopCast()
      await this.ctx.close()
    }
    this.who = who
    this.locale = locale
    this.ctx = await context(this.browser, this.stack, {
      who,
      locale,
      viewport: this.viewport,
      scale: this.scale,
    })
    for (const s of this.initScripts) await this.ctx.addInitScript(s)
    this.page = await this.ctx.newPage()
    this.page.on('framenavigated', (f) => {
      if (f === this.page.mainFrame()) this.urls.push({ t: this.now(), url: f.url() })
    })
    await this.startCast()
  }

  now() {
    return this.t0 ? (Date.now() - this.t0) / 1000 : 0
  }

  async startCast() {
    this.cdp = await this.ctx.newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', async (f) => {
      const file = `${this.dir}/f/${String(this.frames.length).padStart(6, '0')}.jpg`
      writeFileSync(file, Buffer.from(f.data, 'base64'))
      if (!this.t0) this.t0 = Date.now()
      this.frames.push({ file, t: (Date.now() - this.t0) / 1000 })
      try {
        await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId })
      } catch {}
    })
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: this.viewport.width * this.scale,
      maxHeight: this.viewport.height * this.scale,
      everyNthFrame: 1,
    })
  }

  async stopCast() {
    try {
      await this.cdp.send('Page.stopScreencast')
    } catch {}
  }

  mark(id) {
    this.marks.push({ id, t: this.now() })
  }

  /** Where a step's own content ends and its `leave` begins: the frame a caption hold freezes on. */
  hold(id) {
    this.holds.push({ id, t: this.now() })
  }

  /** Removes the stretch `fn` takes from the final video (page loads, waiting on the app). */
  async cut(fn) {
    const a = this.now()
    await fn()
    await sleep(150)
    this.cuts.push([a, this.now()])
  }

  async goto(path, { wait = 600 } = {}) {
    await this.page.goto(this.base + path, { waitUntil: 'networkidle' })
    await this.page.mouse.move(this.mx, this.my)
    await sleep(wait)
  }

  loc(target) {
    return typeof target === 'string' ? this.page.locator(target).first() : target
  }

  /** Moves the pointer to a target, skipping quietly if it is not there. */
  async point(target, opts = {}) {
    return this.moveTo(target, { ...opts, soft: true })
  }

  async moveTo(target, opts = {}) {
    const { dx = 0, dy = 0, ms } = opts
    let x, y
    if (
      typeof target === 'object' &&
      target &&
      'x' in target &&
      'y' in target &&
      !('locator' in target)
    ) {
      x = target.x
      y = target.y
    } else {
      const base = typeof target === 'string' ? this.page.locator(target) : target
      const loc = base.filter({ visible: true }).first()
      await loc.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {})
      await sleep(150)
      const box = await loc.boundingBox({ timeout: opts.soft ? 2000 : 20000 }).catch(() => null)
      if (!box) {
        if (opts.soft) return
        throw new Error(`nothing to point at: ${base}`)
      }
      x = box.x + Math.min(box.width / 2, 60) + dx
      y = box.y + box.height / 2 + dy
      if (box.width < 140) x = box.x + box.width / 2 + dx
    }
    const dist = Math.hypot(x - this.mx, y - this.my)
    const dur = ms ?? Math.min(1100, 380 + dist * 0.7)
    const steps = Math.max(12, Math.round(dur / 16))
    const sx = this.mx
    const sy = this.my
    for (let i = 1; i <= steps; i++) {
      const p = i / steps
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e)
      await sleep(dur / steps)
    }
    this.mx = x
    this.my = y
  }

  async click(target, opts = {}) {
    await this.moveTo(target, opts)
    await sleep(opts.before ?? 220)
    await this.page.mouse.down()
    await sleep(90)
    await this.page.mouse.up()
    await sleep(opts.after ?? 700)
  }

  async type(target, text, { delay = 55, clear = true } = {}) {
    await this.click(target, { after: 250 })
    const loc = this.loc(target)
    if (clear) await loc.fill('')
    await loc.pressSequentially(text, { delay })
    await sleep(400)
  }

  async select(target, option) {
    await this.point(target, { ms: 250 })
    await this.loc(target).selectOption(option)
    await sleep(300)
  }

  async scrollTo(target, { offset = 120, ms = 900 } = {}) {
    const y = await this.loc(target).evaluate(
      (el, off) => el.getBoundingClientRect().top + window.scrollY - off,
      offset,
    )
    await this.smoothScroll(y, ms)
  }

  async smoothScroll(toY, ms = 900) {
    await this.page.evaluate(
      async ({ toY, ms }) => {
        const from = window.scrollY
        const d = toY - from
        const t0 = performance.now()
        await new Promise((res) => {
          const step = (now) => {
            const p = Math.min(1, (now - t0) / ms)
            const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
            window.scrollTo(0, from + d * e)
            if (p < 1) requestAnimationFrame(step)
            else res()
          }
          requestAnimationFrame(step)
        })
      },
      { toY, ms },
    )
    await sleep(250)
  }

  /** The click ripple without activating what is under the pointer (used on PDF links). */
  async ripple() {
    await this.page.evaluate(
      ({ x, y }) =>
        window.dispatchEvent(
          new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }),
        ),
      { x: this.mx, y: this.my },
    )
    await sleep(450)
  }

  /** The dashboard map draws after the page settles; wait for its canvas and tiles. */
  async waitMap() {
    await this.page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 }).catch(() => {})
    await this.page.waitForLoadState('networkidle').catch(() => {})
    await this.page
      .waitForFunction(
        () => {
          const c = document.querySelector('canvas.maplibregl-canvas')
          return c && c.width > 0
        },
        null,
        { timeout: 10000 },
      )
      .catch(() => {})
    await sleep(2500)
  }

  async finish() {
    await sleep(800)
    await this.stopCast()
    const end = this.now()
    await this.browser.close()
    return { end }
  }
}
