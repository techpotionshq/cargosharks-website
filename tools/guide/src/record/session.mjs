// One take of a short: runs its steps in the browser and writes `app.mp4`
// (1440x900, 30 fps, cuts applied) and `meta.json` (marks, holds, URLs,
// annotation checks, all in the cut timeline) into a directory.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expand } from '../catalog.mjs'
import { mkdirp, sleep } from '../util.mjs'
import { Recorder } from './recorder.mjs'
import { ANN_JS, ann } from './annotate.mjs'
import { framesToMp4 } from '../video/frames.mjs'

/** Runs the spec in the browser and writes `app.mp4` + `meta.json` into `dir`. */
export async function record(spec, desc, dir, opts = {}) {
  mkdirp(dir)
  const stack = await desc.ensure()
  const checks = []
  const r = new Recorder(join(dir, 'raw'), stack, {
    who: spec.who ?? 'operations',
    locale: spec.locale ?? 'en',
    viewport: spec.viewport,
  })
  r.initScripts.push(ANN_JS)
  const ctx = {
    stack,
    spec,
    sleep,
    dlg: () => r.page.locator('dialog[open], [role=dialog]').last(),
    t: (k) => expand(`{app:${k}}`, spec.locale ?? 'en').text,
    data: {},
  }
  if (opts.ctx) Object.assign(ctx, opts.ctx)
  else if (stack.prepare) await stack.prepare(spec, ctx)
  if (spec.before) await spec.before(ctx)
  await r.start()
  await r.goto(typeof spec.start === 'function' ? await spec.start(ctx) : spec.start, { wait: 300 })
  if (spec.ready) await spec.ready(r, ctx)
  await r.page.evaluate(ANN_JS)
  const a = ann(r, checks)
  // Recording proper starts here: everything before was getting to the first screen.
  await sleep(200)
  r.t0 = null
  r.frames.length = 0
  await r.page.mouse.move(r.mx + 1, r.my)
  await sleep(250)
  r.urls.length = 0
  r.urls.push({ t: 0, url: r.page.url() })
  let n = 0
  for (const s of spec.steps) {
    r.mark(s.id)
    if (s.label) await a.step(++n, expand(s.label, spec.locale ?? 'en').text)
    if (s.run) await s.run(r, a, ctx)
    else if (s.focus) {
      const f = s.focus
      await a.focus(
        typeof f.target === 'function' ? f.target(r.page, ctx) : r.page.locator(f.target).first(),
        f.callout ? expand(f.callout).text : null,
        f,
      )
      await sleep(f.hold ?? 2000)
    }
    r.hold(s.id)
    if (s.leave) await s.leave(r, a, ctx)
  }
  await a.verify()
  await sleep(500)
  const { end } = await r.finish()
  // Apply the cuts: drop frames inside them and pull everything after them earlier.
  const cuts = r.cuts
  const map = (t) => {
    let s = 0
    for (const [x, y] of cuts) {
      if (t >= y) s += y - x
      else if (t > x) return x - s
    }
    return t - s
  }
  const inCut = (t) => cuts.some(([x, y]) => t > x && t < y)
  const frames = r.frames.filter((f) => !inCut(f.t)).map((f) => ({ ...f, t: map(f.t) }))
  const meta = {
    end: map(end),
    marks: r.marks.map((m) => ({ ...m, t: map(m.t) })),
    holds: r.holds.map((m) => ({ ...m, t: map(m.t) })),
    urls: r.urls.map((u) => ({ ...u, t: map(u.t) })),
    checks: checks.map((c) => ({ ...c, t: map(c.t) })),
    cuts,
    viewport: r.viewport,
    device: r.device,
  }
  framesToMp4(frames, meta.end, join(dir, 'app.mp4'), dir, r.viewport)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 1))
  rmSync(join(dir, 'raw'), { recursive: true, force: true })
}
