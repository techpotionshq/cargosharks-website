/**
 * PDF rendering — Architecture §2, NFR-01.
 *
 * Headless Chromium over HTML templates. It is the only renderer with
 * dependable Arabic shaping and right-to-left layout, and using the same HTML
 * pipeline as the screen means RTL is solved once for both rather than twice
 * with two sets of bugs.
 *
 * The templates share `globals.css`, so a logical property fixed on screen is
 * fixed on the invoice.
 */

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
 * Not yet implemented: Chromium is a heavyweight dependency and belongs in the
 * container image rather than in a developer's node_modules. The interface is
 * fixed now because the invoice, quote, delivery order and job pack all render
 * through it and their templates are being written against this shape.
 */
export function createRenderer(): Renderer {
  return {
    async render() {
      throw new Error('PDF renderer not yet wired — see Dockerfile.service for the Chromium layer')
    },
    async close() {},
  }
}
