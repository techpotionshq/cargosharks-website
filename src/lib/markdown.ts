import { Marked } from 'marked'

/**
 * Post bodies, Markdown to HTML, with what a model-written body may and may not
 * put on the page. Kept apart from `blog.ts` so it imports nothing from the
 * CMS and `test/blog.test.ts` can pin it down without a database.
 */

/**
 * The URL schemes a post may link to. Anything else (`javascript:`, `data:`,
 * `vbscript:`) is model output that would run on cargosharks.com, and it reads
 * as innocently in a Markdown diff as a link to a carrier's tariff page.
 * Control characters and whitespace are stripped first, because a browser
 * ignores them inside a scheme and `java\tscript:` would otherwise pass.
 */
function safeUrl(url: string, { mailto }: { mailto: boolean }): string | null {
  const bare = url.replace(/[\s\p{Cc}]/gu, '')
  if (/^https?:\/\//i.test(bare)) return url
  if (mailto && /^mailto:/i.test(bare)) return url
  // Same-site paths and fragments, but not `//host` or `/\host`: a browser
  // reads either as another site.
  if (/^[/#]/.test(bare) && !/^[/\\]{2}/.test(bare)) return url
  return null
}

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
// For text that lands between tags rather than inside a quoted attribute, where
// `<` opens an element and `attr` alone would let one through.
const text = (value: string) => attr(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Markdown to HTML. Raw HTML in the source is escaped rather than passed
 * through — the body is model output reviewed in a diff, and a `<script>` in a
 * diff is easy to miss. A link with a scheme `safeUrl` does not allow becomes
 * its plain text. Links off the site open with `rel="noopener"`.
 */
const marked = new Marked({
  gfm: true,
  renderer: {
    html({ text: raw }) {
      return text(raw)
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens)
      const safe = safeUrl(href, { mailto: true })
      if (!safe) return label
      const external = /^https?:\/\//i.test(safe) && !safe.startsWith('https://cargosharks.com')
      const t = title ? ` title="${attr(title)}"` : ''
      return external
        ? `<a href="${attr(safe)}"${t} rel="noopener" target="_blank">${label}</a>`
        : `<a href="${attr(safe)}"${t}>${label}</a>`
    },
    image({ href, title, text: alt }) {
      const safe = safeUrl(href, { mailto: false })
      // The alt text stands in for the image as page text, so it is escaped as
      // text: `![<img src=x onerror=…>](javascript:x)` must not become markup.
      if (!safe) return text(alt)
      const t = title ? ` title="${attr(title)}"` : ''
      return `<img src="${attr(safe)}" alt="${attr(alt)}"${t} loading="lazy">`
    },
  },
})

/** Tables scroll inside their own box on a phone instead of moving the page. */
function wrapTables(html: string): string {
  return html
    .replace(/<table>/g, '<div class="tablewrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
}

/** A post body as the site renders it. Exported for `test/blog.test.ts`. */
export function renderMarkdown(source: string): string {
  return wrapTables(marked.parse(source, { async: false }) as string)
}
