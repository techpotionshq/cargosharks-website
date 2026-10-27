import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Marked } from 'marked'
import type { Lang } from '@/content/copy'

/**
 * The blog, read from files at build time.
 *
 * A post is a directory under `content/blog/<slug>/`: `post.json` for what a
 * page needs before its body (title, dates, the FAQ, the cover), and one
 * Markdown file per language it is written in. That split is what lets
 * `scripts/blog/generate.mjs` write a post as plain files and open a pull
 * request — merging the PR is publishing, and the site stays a static export
 * with no CMS to host.
 *
 * **Everything is validated here, and a bad post fails the build.** The files
 * are mostly written by a model, and the pull request's build is the one gate
 * every draft passes through on its way to `main`. A missing title should stop
 * that build, not ship a page titled "undefined".
 */

const ROOT = join(process.cwd(), 'content', 'blog')

/** Today in UTC, to the day. */
const TODAY = new Date().toISOString().slice(0, 10)

export type Faq = { question: string; answer: string }

export type PostCopy = {
  title: string
  excerpt: string
  /** 140–160 characters; falls back to `excerpt`. */
  metaDescription?: string
  focusKeyword?: string
  faqs: Faq[]
}

export type PostMeta = {
  slug: string
  /** ISO date, `YYYY-MM-DD`, not in the future; see `readMeta`. */
  publishedAt: string
  updatedAt?: string
  author: string
  tags: string[]
  /** A path under `public/`, e.g. `/blog/<slug>.webp`. */
  cover?: string
  source: 'ai' | 'human'
  en?: PostCopy
  ar?: PostCopy
}

export type Post = PostMeta & { lang: Lang; copy: PostCopy; html: string; readingTime: number }

function fail(slug: string, message: string): never {
  throw new Error(`content/blog/${slug}: ${message}`)
}

function checkCopy(slug: string, lang: Lang, copy: unknown): PostCopy {
  const c = copy as Partial<PostCopy>
  if (!c?.title?.trim()) fail(slug, `${lang}.title is missing`)
  if (!c.excerpt?.trim()) fail(slug, `${lang}.excerpt is missing`)
  if (!Array.isArray(c.faqs)) fail(slug, `${lang}.faqs must be an array (empty is fine)`)
  for (const f of c.faqs)
    if (!f?.question || !f?.answer)
      fail(slug, `${lang}.faqs has an entry without a question or answer`)
  return c as PostCopy
}

function readMeta(slug: string): PostMeta {
  const raw = JSON.parse(readFileSync(join(ROOT, slug, 'post.json'), 'utf8')) as Partial<PostMeta>
  if (raw.slug !== slug) fail(slug, `post.json slug "${raw.slug}" does not match its directory`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.publishedAt ?? ''))
    fail(slug, 'publishedAt must be YYYY-MM-DD')
  // Refused rather than held back. The site rebuilds only on a push to `main`,
  // so a post dated tomorrow would not appear tomorrow; it would appear at
  // whatever unrelated push came next, and IndexNow would have given up on it.
  // Dates are UTC on both sides: generate.mjs and the build both run on CI.
  if (raw.publishedAt! > TODAY)
    fail(
      slug,
      `publishedAt ${raw.publishedAt} is in the future; nothing rebuilds the site that day`,
    )
  if (raw.cover && !existsSync(join(process.cwd(), 'public', raw.cover)))
    fail(slug, `cover ${raw.cover} is not in public/`)
  const meta = { author: 'CargoSharks', tags: [], source: 'human', ...raw } as PostMeta
  for (const lang of ['en', 'ar'] as const) {
    if (!meta[lang]) continue
    meta[lang] = checkCopy(slug, lang, meta[lang])
    if (!existsSync(join(ROOT, slug, `${lang}.md`)))
      fail(slug, `${lang} copy in post.json but no ${lang}.md`)
  }
  if (!meta.en && !meta.ar) fail(slug, 'post.json has neither en nor ar copy')
  // A hand-written post may skip the FAQ. A generated one always asks for it,
  // so an empty list there is a dropped answer, and the page would ship with
  // no FAQ section and no FAQPage schema. Twins match either way: one language
  // with an FAQ and the other without is the same defect.
  const withFaqs = (['en', 'ar'] as const).filter((l) => meta[l]?.faqs.length)
  const present = (['en', 'ar'] as const).filter((l) => meta[l])
  if (meta.source === 'ai' && withFaqs.length < present.length)
    fail(
      slug,
      `generated post with no FAQ in ${present.filter((l) => !withFaqs.includes(l)).join(' and ')}`,
    )
  if (withFaqs.length && withFaqs.length < present.length)
    fail(slug, `${withFaqs[0]} has an FAQ and its twin does not`)
  return meta
}

let cache: PostMeta[] | null = null

/** Every published post, newest first. */
export function allPosts(): PostMeta[] {
  if (cache) return cache
  const slugs = existsSync(ROOT)
    ? readdirSync(ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : []
  cache = slugs.map(readMeta).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  return cache
}

export function postsIn(lang: Lang): PostMeta[] {
  return allPosts().filter((post) => post[lang])
}

/**
 * The blog indexes worth pointing at: each language's, once it has a post.
 * Keyed for an hreflang `languages` map, `x-default` included, so an English
 * index never names an empty Arabic one as its twin (or the reverse).
 */
export function blogIndexAlternates(origin = ''): Record<string, string> {
  const langs = (['en', 'ar'] as const).filter((lang) => postsIn(lang).length)
  const map: Record<string, string> = {}
  for (const lang of langs) map[lang] = `${origin}${blogPath(lang)}`
  if (langs.length) map['x-default'] = map.en ?? map.ar!
  return map
}

/**
 * The slug a post route builds when a language has no posts yet.
 *
 * A static export refuses a dynamic route whose `generateStaticParams()` is
 * empty, which is every blog route before the pipeline's first merge. So the
 * route builds this one slug, renders the 404 for it (`getPost` finds nothing),
 * and `scripts/postbuild.mjs` deletes the file. Nothing links to it either way.
 */
const NO_POSTS_SLUG = '_no-posts'

export function postParams(lang: Lang): { slug: string }[] {
  const posts = postsIn(lang)
  return posts.length ? posts.map((post) => ({ slug: post.slug })) : [{ slug: NO_POSTS_SLUG }]
}

export function blogPath(lang: Lang, slug?: string): string {
  const base = lang === 'ar' ? '/ar/blog/' : '/blog/'
  return slug ? `${base}${slug}/` : base
}

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

export function getMeta(slug: string): PostMeta | null {
  return allPosts().find((post) => post.slug === slug) ?? null
}

// A page's `generateMetadata` needs only `getMeta`; this keeps a body parsed
// once per language even when something calls `getPost` twice.
const parsed = new Map<string, Post | null>()

export function getPost(slug: string, lang: Lang): Post | null {
  const key = `${slug}:${lang}`
  if (parsed.has(key)) return parsed.get(key)!
  const meta = getMeta(slug)
  const copy = meta?.[lang]
  let post: Post | null = null
  if (meta && copy) {
    const source = readFileSync(join(ROOT, slug, `${lang}.md`), 'utf8')
    const words = source.trim().split(/\s+/).length
    post = {
      ...meta,
      lang,
      copy,
      html: renderMarkdown(source),
      // ~200 words a minute, floor of one.
      readingTime: Math.max(1, Math.round(words / 200)),
    }
  }
  parsed.set(key, post)
  return post
}
