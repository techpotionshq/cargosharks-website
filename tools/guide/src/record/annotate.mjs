// Annotations for the shorts.
//
// The rule: annotations are drawn in SCREEN space (a fixed, untransformed
// top-layer overlay) and only after any zoom has settled, from a fresh
// getBoundingClientRect. They are cleared before the view moves again (scroll,
// zoom-out, navigation). So the box, the dim mask and the callout always sit
// exactly on the element, and nothing moves while they are visible. Every
// focus is measured twice (when drawn and when cleared) and the numbers go
// into the short's check report, which is how a drifting box gets caught
// without anybody watching the video.
import { colors } from '../brand.mjs'
import { expand } from '../catalog.mjs'

const C = {
  ring: colors.brand,
  ringSoft: `color-mix(in oklch, ${colors.brand} 25%, transparent)`,
  mask: `color-mix(in oklch, ${colors.deep} 42%, transparent)`,
  call: colors.deep,
  callEm: colors.soft,
  ink: colors.deep,
}

export const ANN_JS = `
window.__ann = (() => {
  const css = document.createElement('style');
  css.textContent = \`
  .ann-layer *{box-sizing:border-box}
  .ann-spot{position:fixed;z-index:1;border:3px solid ${C.ring};border-radius:12px;box-shadow:0 0 0 9999px ${C.mask},0 0 0 7px ${C.ringSoft};opacity:0;transition:opacity .25s}
  .ann-call{position:fixed;z-index:3;width:max-content;max-width:420px;background:${C.call};color:#fff;font:600 19px/1.35 Inter,system-ui,sans-serif;padding:12px 16px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);opacity:0;transition:opacity .25s}
  .ann-call b{color:${C.callEm};font-weight:700}
  .ann-step{position:fixed;z-index:3;left:24px;bottom:22px;display:flex;align-items:center;gap:12px;background:#fff;color:${C.ink};font:800 25px/1 Manrope,Inter,sans-serif;padding:10px 20px 10px 10px;border-radius:999px;box-shadow:0 8px 28px rgba(0,0,0,.25);border:2px solid ${C.ring}}
  .ann-step i{font-style:normal;display:inline-flex;width:40px;height:40px;border-radius:50%;background:${C.ring};color:#fff;align-items:center;justify-content:center;font-size:20px}
  .ann-wa{position:fixed;z-index:3;right:48px;top:110px;width:470px;background:#ECE5DD;border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.3);overflow:hidden;font:19px/1.45 Inter,system-ui,sans-serif;opacity:0;transition:opacity .3s}
  .ann-wa .h{background:#075E54;color:#fff;padding:10px 14px;font-weight:600;display:flex;gap:10px;align-items:center}
  .ann-wa .h span{width:30px;height:30px;border-radius:50%;background:#25D366;display:inline-flex;align-items:center;justify-content:center;font-weight:700}
  .ann-wa .m{margin:12px;background:#fff;border-radius:10px;padding:9px 12px;color:#111;box-shadow:0 1px 1px rgba(0,0,0,.1)}
  .ann-wa .t{display:block;text-align:right;font-size:12px;color:#777;margin-top:3px}
  .ann-on{opacity:1!important}
  @media (max-width:600px){.ann-call{max-width:260px;font-size:15px;padding:9px 12px}.ann-step{left:10px;bottom:12px;font-size:16px;padding:6px 12px 6px 6px;gap:8px}.ann-step i{width:28px;height:28px;font-size:14px}.ann-wa{right:12px;left:12px;width:auto;font-size:15px}}
  \`;
  const SMALL = innerWidth < 600, MARGIN = SMALL ? 12 : 48, STEP_ZONE = SMALL ? 64 : 92;
  let layer;
  const ensure = () => {
    if (!css.isConnected) document.head.appendChild(css);
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div'); layer.className = 'ann-layer'; layer.setAttribute('popover', 'manual');
      layer.style.cssText = 'position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100vh;max-width:none;max-height:none;overflow:visible;pointer-events:none';
      document.documentElement.appendChild(layer); try { layer.showPopover() } catch (e) {}
    } else if (document.querySelector('dialog[open]')) {
      // a dialog opened after the layer: move the layer back on top of it
      try { layer.hidePopover(); layer.showPopover() } catch (e) {}
    }
    return layer;
  };
  // keep the overlay above any dialog that opens later (dialogs join the top layer when shown)
  const mo = new MutationObserver((muts) => {
    if (!layer || !layer.isConnected) return;
    if (muts.some((m) => m.target.tagName === 'DIALOG' || [...m.addedNodes].some((n) => n.nodeType === 1 && (n.tagName === 'DIALOG' || n.querySelector?.('dialog'))))) {
      setTimeout(() => { try { layer.hidePopover(); layer.showPopover() } catch (e) {} }, 20);
    }
  });
  const watch = () => { try { mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true }) } catch (e) {} };
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch);
  const on = (el) => requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('ann-on')));
  const kill = (sel) => { if (!layer) return; layer.querySelectorAll(sel).forEach((e) => e.remove()); };
  const fade = (sel) => { if (!layer) return; layer.querySelectorAll(sel).forEach((e) => { e.classList.remove('ann-on'); setTimeout(() => e.remove(), 260); }); };
  const fits = (x, y, w, h) => x >= MARGIN && y >= MARGIN && x + w <= innerWidth - MARGIN && y + h <= innerHeight - STEP_ZONE;
  return {
    step(n, text) { kill('.ann-step'); const d = document.createElement('div'); d.className = 'ann-step'; d.innerHTML = '<i>' + n + '</i>' + text; ensure().appendChild(d); },
    /** Draws box + mask + callout on a SCREEN rect. Returns the drawn rects for the self-check. */
    focus(r, html, side, pad) {
      fade('.ann-spot,.ann-call');
      const L = ensure();
      const s = document.createElement('div'); s.className = 'ann-spot';
      s.style.left = (r.x - pad) + 'px'; s.style.top = (r.y - pad) + 'px'; s.style.width = (r.width + 2 * pad) + 'px'; s.style.height = (r.height + 2 * pad) + 'px';
      L.appendChild(s); on(s);
      const out = { spot: { x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad } };
      if (html) {
        const c = document.createElement('div'); c.className = 'ann-call'; c.innerHTML = html; c.style.left = '-9999px'; L.appendChild(c);
        const w = c.offsetWidth, h = c.offsetHeight, g = 18 + pad;
        const pos = {
          right: [r.x + r.width + g, r.y + r.height / 2 - h / 2],
          left: [r.x - w - g, r.y + r.height / 2 - h / 2],
          below: [r.x, r.y + r.height + g],
          above: [r.x, r.y - h - g],
        };
        const flip = { right: 'left', left: 'right', below: 'above', above: 'below' };
        const order = [side, flip[side], ...['below', 'above', 'right', 'left'].filter((k) => k !== side && k !== flip[side])];
        let chosen = null;
        for (const k of order) {
          let [x, y] = pos[k];
          // slide along the edge it sits on, to stay inside the margin
          if (k === 'right' || k === 'left') y = Math.max(MARGIN, Math.min(innerHeight - STEP_ZONE - h, y));
          else x = Math.max(MARGIN, Math.min(innerWidth - MARGIN - w, x));
          if (fits(x, y, w, h)) { chosen = [x, y, k]; break; }
        }
        if (!chosen) { const [x, y] = pos[side]; chosen = [Math.max(MARGIN, Math.min(innerWidth - MARGIN - w, x)), Math.max(MARGIN, Math.min(innerHeight - STEP_ZONE - h, y)), side + '*']; }
        c.style.left = chosen[0] + 'px'; c.style.top = chosen[1] + 'px'; on(c);
        out.call = { x: chosen[0], y: chosen[1], width: w, height: h, side: chosen[2] };
      }
      return out;
    },
    wa(name, text, time) { kill('.ann-wa'); const d = document.createElement('div'); d.className = 'ann-wa'; d.innerHTML = '<div class="h"><span>' + name[0] + '</span>' + name + '</div><div class="m">' + text + '<span class="t">' + time + '</span></div>'; ensure().appendChild(d); on(d); },
    unwa() { fade('.ann-wa'); },
    clear() { fade('.ann-spot,.ann-call,.ann-wa'); },
    clearNow() { kill('.ann-spot,.ann-call,.ann-wa'); },
    /** Zoom the page (origin top-left) so doc point under screen rect r goes to screen centre. */
    zoom(r, sc, ms) {
      const b = document.body, vw = innerWidth, vh = innerHeight;
      // Hide what is pinned to the VIEWPORT: under a transformed body a fixed
      // topbar or a document-sticky sidebar lands mid-page. A sticky element
      // inside its own scroll box is not one of those: it moves with the body
      // like any other content. Every table header is that case (THead is
      // sticky inside TableShell's overflow-x-auto box), and hiding them all
      // was why every zoomed register in the shorts had an empty header row.
      const viewportPinned = (e) => {
        const p = getComputedStyle(e).position;
        if (p === 'fixed') return true;
        if (p !== 'sticky') return false;
        for (let a = e.parentElement; a && a !== b && a !== document.documentElement; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX + ' ' + s.overflowY)) return false;
        }
        return true;
      };
      if (!window.__pinned) window.__pinned = [...b.querySelectorAll('*')].filter(viewportPinned);
      // Never the chrome the step is pointing into. The bell's popover lives
      // in the sticky topbar, so short 13 hid the very panel it zoomed onto
      // and drew the spotlight over the empty map behind it.
      const target = document.querySelector('[data-ann-target]');
      window.__pinned.forEach((e) => { if (target && e.contains(target)) return; e.style.transition = 'opacity .2s'; e.style.opacity = '0'; });
      const pcx = r.x + r.width / 2 + scrollX, pcy = r.y + r.height / 2 + scrollY;
      let tx = vw / 2 + scrollX - sc * pcx, ty = vh / 2 + scrollY - sc * pcy;
      const dh = document.documentElement.scrollHeight;
      tx = Math.min(0, Math.max(vw - sc * vw, tx));
      ty = Math.min(scrollY, Math.max(scrollY + vh - sc * dh, ty));
      // Bring the column headers along when the zoom leaves them above the
      // frame. A register's THead sticks inside TableShell's own scroll box,
      // not to the page, so a zoom centred on a row far down a long table
      // (short 04: the story's shipment is row 10 of 11) shows rows with no
      // labels. The header slides down with the zoom to the top of the frame,
      // as a page-sticky header would, and never over the row being pointed at.
      const head = target && target.closest('table') && target.closest('table').querySelector(':scope > thead');
      const row = target && target.closest('tr');
      if (head && row && !head.contains(target)) {
        // Measured before the body moves: these are untransformed page positions.
        const hr = head.getBoundingClientRect(), rr = row.getBoundingClientRect();
        const hTop = hr.top + scrollY, rTop = rr.top + scrollY;
        const screenTop = ty + sc * hTop - scrollY;
        const d = Math.min((0 - screenTop) / sc, rTop - hr.height - hTop);
        if (screenTop < 0 && d > 0) {
          head.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,0,.2,1)';
          head.style.transform = 'translateY(' + d + 'px)';
          window.__slidHead = head;
        }
      }
      b.style.transformOrigin = '0 0'; b.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,0,.2,1)';
      b.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sc + ')';
    },
    unzoom(ms) {
      const h = window.__slidHead; if (h) { h.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,0,.2,1)'; h.style.transform = ''; window.__slidHead = null; }
      (window.__pinned || []).forEach((e) => { e.style.opacity = ''; }); window.__pinned = null;
      const b = document.body; b.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,0,.2,1)'; b.style.transform = 'none';
    },
    zoomed() { const t = document.body.style.transform; return !!t && t !== 'none'; },
    /** Marks the focus target, so zoom and reveal know which chrome to spare. */
    target(el) { document.querySelectorAll('[data-ann-target]').forEach((e) => e.removeAttribute('data-ann-target')); if (el) el.setAttribute('data-ann-target', ''); },
    /**
     * Shows again any chrome hidden by an earlier zoom that holds the new
     * target. A step that focuses without zooming keeps the previous zoom,
     * and with it the hidden topbar: short 13's Save button was inside it.
     */
    reveal() { const t = document.querySelector('[data-ann-target]'); if (t) (window.__pinned || []).forEach((e) => { if (e.contains(t)) e.style.opacity = ''; }); },
  };
})();
`

// Node-side geometry for zoom and checks; set per recorder from its viewport.
let VW = 1440,
  VH = 900,
  MARGIN = 48,
  STEP_ZONE = 92,
  CALL_W = 420,
  CALL_H = 110

/** Helpers bound to a Recorder. `checks` collects annotation-vs-element measurements. */
export function ann(r, checks = []) {
  VW = r.viewport.width
  VH = r.viewport.height
  const small = VW < 600
  MARGIN = small ? 12 : 48
  STEP_ZONE = small ? 64 : 92
  CALL_W = small ? 260 : 420
  CALL_H = small ? 80 : 110
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
  const loc = (l) => (typeof l === 'string' ? r.page.locator(l).first() : l)
  const ev = async (fn, ...a) => {
    if (!(await r.page.evaluate(() => !!window.__ann))) await r.page.evaluate(ANN_JS)
    return r.page.evaluate(({ fn, a }) => window.__ann[fn](...a), { fn, a })
  }
  let zoomed = false
  let last = null
  const verify = async () => {
    if (!last) return
    const { l, sp, pad, rec } = last
    last = null
    const b = await l.boundingBox().catch(() => null)
    if (!b) {
      rec.endErr = 'gone'
      return
    }
    rec.endErr = Math.round(
      Math.max(
        Math.abs(sp.x + pad - b.x),
        Math.abs(sp.y + pad - b.y),
        Math.abs(sp.width - 2 * pad - b.width),
        Math.abs(sp.height - 2 * pad - b.height),
      ),
    )
  }
  const api = {
    verify,
    step: (n, t) => ev('step', n, t),
    wa: (n, t, time) => ev('wa', n, t, time),
    unwa: () => ev('unwa'),
    clear: async () => {
      await verify()
      await ev('clear')
      await sleep(120)
    },
    async unzoom(ms = 420) {
      await verify()
      if (!zoomed) return
      await ev('clearNow')
      await ev('unzoom', ms)
      await sleep(ms + 80)
      zoomed = false
    },
    /**
     * Focus an element: optional smooth zoom (scale chosen so element + callout fit with a 48px margin),
     * then, once settled, measure it and draw box, mask and callout in screen space.
     */
    async focus(target, html, { side = 'right', zoom = 0, pad = 6, label } = {}) {
      // Callouts may quote product labels as {app:key}, like the rest of the guide.
      if (html) html = expand(html).text
      const l = loc(target)
      await verify()
      await ev('clearNow')
      if (!(await r.page.evaluate(() => !!window.__ann))) await r.page.evaluate(ANN_JS)
      await l.evaluate((el) => window.__ann.target(el)).catch(() => {})
      if (zoom) {
        if (zoomed) await api.unzoom(350)
        const b0 = await l.boundingBox()
        const horiz = side === 'left' || side === 'right'
        const needW = html && horiz ? CALL_W + 30 : 0
        const needH = html && !horiz ? CALL_H + 30 : 0
        const maxW = (VW - 2 * MARGIN - needW) / (b0.width + 2 * pad)
        const maxH = (VH - MARGIN - STEP_ZONE - needH) / (b0.height + 2 * pad)
        const sc = Math.max(1, Math.min(zoom, maxW, maxH))
        if (sc > 1.02) {
          await ev('zoom', b0, sc, 600)
          await sleep(680)
          zoomed = true
        }
      }
      await ev('reveal')
      let b = await l.boundingBox()
      const offNow = (x) => x.x < 0 || x.y < 0 || x.x + x.width > VW || x.y + x.height > VH
      if (zoomed && offNow(b)) {
        await api.unzoom(350)
        b = await l.boundingBox()
      }
      const drawn = await ev('focus', b, html ?? null, side, pad)
      const sp = drawn.spot
      const off = (x) => x.x < 0 || x.y < 0 || x.x + x.width > VW || x.y + x.height > VH
      const rec = {
        label: label ?? (html ? html.replace(/<[^>]+>/g, '').slice(0, 50) : 'focus'),
        t: r.now(),
        el: {
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.round(b.width),
          h: Math.round(b.height),
        },
        boxErr: Math.round(
          Math.max(
            Math.abs(sp.x + pad - b.x),
            Math.abs(sp.y + pad - b.y),
            Math.abs(sp.width - 2 * pad - b.width),
            Math.abs(sp.height - 2 * pad - b.height),
          ),
        ),
        elementOffFrame: off(b),
        calloutOffFrame: drawn.call ? off(drawn.call) : false,
        calloutSide: drawn.call?.side,
      }
      checks.push(rec)
      last = { l, sp, pad, rec }
      await sleep(260)
      return drawn
    },
  }
  return api
}
