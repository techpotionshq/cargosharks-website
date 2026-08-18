/**
 * PDF rendering — §8, NFR-01.
 *
 * Chromium, and the reason is Arabic rather than layout.
 *
 * Every document this system issues renders bilingually: an invoice, a
 * quotation, a delivery order, a job pack. Arabic needs three things that
 * general-purpose PDF libraries do not do — the bidirectional algorithm, the
 * contextual shaping that changes a letter's form by its position in a word,
 * and ligatures such as lam-alef. `pdfkit`, `jsPDF` and `pdf-lib` all produce
 * disconnected, backwards Arabic without a great deal of specialist work;
 * Chromium has HarfBuzz built in and gets all three right.
 *
 * It also already understands the CSS logical properties (`ms-`/`me-`) written
 * throughout `apps/web`, so a document inherits the same brand tokens as the
 * interface. `packages/brand` was built for exactly this — *"the same tokens
 * into PDF letterhead through Chromium. One source, two renderers."*
 *
 * `infra/Dockerfile.service` already installs Chromium and the Arabic fonts
 * (`fonts-kacst`, `fonts-noto-core`) and sets `CHROMIUM_EXECUTABLE_PATH`, so
 * the heavyweight dependency was accepted and paid at the image layer. What
 * was missing was only the code that drives it.
 *
 * `playwright-core` rather than `playwright`: no bundled browser download, it
 * uses the system binary, and it is the same API the end-to-end suite already
 * uses.
 */

import { chromium, type Browser } from 'playwright-core'

export interface RenderRequest {
  /** Fully-formed HTML — the caller renders the template, this prints it. */
  readonly html: string
  readonly locale: 'en' | 'ar'
  /** Per-entity letterhead — five legal entities, five headers (FR-ID-01). */
  readonly headerHtml?: string
  readonly footerHtml?: string
}

export interface Renderer {
  render(request: RenderRequest): Promise<Buffer>
  close(): Promise<void>
}

/**
 * One browser, many documents.
 *
 * Launching Chromium costs a few hundred milliseconds and a great deal of
 * memory; doing it per invoice would make a month-end run of two hundred
 * documents unusable. The browser is shared and each render gets its own
 * context, which is the isolation boundary that matters — a context cannot see
 * another's cookies, storage or state.
 */
let shared: Browser | undefined

async function browser(): Promise<Browser> {
  if (shared?.isConnected()) return shared

  shared = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: [
      // The container runs as an unprivileged user with no sandbox namespace
      // available. Safe here because the only HTML rendered is our own
      // templates — never user-supplied markup.
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  })

  return shared
}

export function createRenderer(): Renderer {
  return {
    async render(request: RenderRequest): Promise<Buffer> {
      const context = await (
        await browser()
      ).newContext({
        // The locale reaches Chromium so that `Intl`, date formatting and font
        // fallback inside the document agree with the rest of the system.
        locale: request.locale === 'ar' ? 'ar-KW' : 'en-GB',
        timezoneId: 'Asia/Kuwait',
      })

      const page = await context.newPage()

      try {
        /*
          `setContent` rather than a URL.

          The caller has already rendered the template — this prints what it is
          given and never fetches. A renderer that could be pointed at a URL is
          a server-side request forgery waiting to be found, and it would also
          make document output depend on the web app being reachable.
        */
        await page.setContent(request.html, { waitUntil: 'networkidle' })

        return await page.pdf({
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: Boolean(request.headerHtml ?? request.footerHtml),
          headerTemplate: request.headerHtml ?? '<span></span>',
          footerTemplate: request.footerHtml ?? '<span></span>',
          margin: request.headerHtml
            ? { top: '38mm', bottom: '22mm', left: '14mm', right: '14mm' }
            : { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
        })
      } finally {
        // Closed even when the render throws: a leaked context is a leaked
        // renderer process, and a month-end batch would exhaust the container.
        await context.close()
      }
    },

    async close(): Promise<void> {
      await shared?.close().catch(() => {})
      shared = undefined
    },
  }
}
