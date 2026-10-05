// Shows a PDF the app produced inside the recording: the pages as images on a
// plain viewer page, so annotations can point at them. The PDF is fetched with
// the recording's own session, rendered with pdftoppm, and the URL bar shows
// the document's real address.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURSOR_JS } from '../../../../tools/guide/src/record/recorder.mjs'
import { ANN_JS } from '../../../../tools/guide/src/record/annotate.mjs'

export async function pdfPage(r, path, name) {
  const res = await r.page.request.get(r.base + path)
  if (!res.ok()) throw new Error(`${path} answered ${res.status()}`)
  const dir = mkdtempSync(join(tmpdir(), 'guide-pdf-'))
  writeFileSync(join(dir, 'doc.pdf'), await res.body())
  execFileSync('pdftoppm', ['-r', '150', '-png', join(dir, 'doc.pdf'), join(dir, 'p')])
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort()
  const imgs = pages
    .map(
      (p) =>
        `<div class="pdfpage" style="width:820px;height:770px;overflow:hidden;margin:28px auto;box-shadow:0 6px 24px rgba(0,0,0,.35);background:#fff"><img src="data:image/png;base64,${readFileSync(join(dir, p)).toString('base64')}" style="display:block;width:820px"></div>`,
    )
    .join('')
  rmSync(dir, { recursive: true, force: true })
  r.urls.push({ t: r.now(), url: r.base + path })
  await r.page.setContent(
    `<!doctype html><html><body style="margin:0;background:#525659;min-height:100vh"><div style="position:sticky;top:0;height:44px;background:#323639;color:#eee;font:13px Inter,sans-serif;display:flex;align-items:center;padding:0 18px;z-index:2">${name}.pdf</div>${imgs}</body></html>`,
  )
  await r.page.evaluate('window.__cursorInstalled=false;' + CURSOR_JS)
  await r.page.evaluate(ANN_JS)
  await r.page.evaluate(() => scrollTo(0, 0))
  await r.page.mouse.move(r.mx + 1, r.my)
}
