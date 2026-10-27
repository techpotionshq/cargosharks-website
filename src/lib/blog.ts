import config from '@payload-config'
import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'
import { renderMarkdown } from '@/lib/markdown'
import { BLOG_TAG } from '@/cms/collections/Posts'
import type { Lang } from '@/content/copy'
import type { Media, Post as PostDoc } from '@/payload-types'

/**
 * The blog, read from the CMS (`src/payload.config.ts`, `/admin`).
 *
 * It used to be files under `content/blog/`, validated at build and published
 * by merging a pull request. Now a post is a row: the admin publishes it, the
 * `afterChange` hook in `src/cms/collections/Posts.ts` invalidates `BLOG_TAG`,
 * and the next request reads the new list. Reads are cached under that tag (an
 * hour at most otherwise), so a page view does not cost a query.
 *
 * Only published posts are read here, filtered explicitly: the Local API runs
 * with access control overridden, so the collection's own read rule does not
 * apply. Drafts come only through `getPost(..., { draft: true })`, which the
 * preview route enables for a signed-in admin.
 */

export type Faq = { question: string; answer: string }

export type PostCopy = {
  title: string
  excerpt: string
  /** 140 to 160 characters; falls back to `excerpt`. */
  metaDescription?: string
  focusKeyword?: string
  faqs: Faq[]
  /** The Markdown source. */
  body: string
}

export type PostMeta = {
  slug: string
  /** `YYYY-MM-DD`. */
  publishedAt: string
  updatedAt?: string
  author: string
  tags: string[]
  /** The cover's URL, as Payload serves it. */
  cover?: string
  source: 'ai' | 'human'
  en?: PostCopy
  ar?: PostCopy
}

export type Post = PostMeta & { lang: Lang; copy: PostCopy; html: string; readingTime: number }

/** A field read with `locale: 'all'`: one value per language. */
type Localised<T> = Partial<Record<Lang, T | null>> | null | undefined

function copyIn(doc: PostDoc, lang: Lang): PostCopy | undefined {
  const pick = <T>(field: unknown) => (field as Localised<T>)?.[lang] ?? undefined
  const title = pick<string>(doc.title)?.trim()
  const body = pick<string>(doc.body)?.trim()
  // A language exists on the site once it has a title and a body; an excerpt
  // alone is a half-written translation, not a page.
  if (!title || !body) return undefined
  const faqs = (pick<Faq[]>(doc.faqs) ?? []).filter((f) => f.question && f.answer)
  return {
    title,
    excerpt: pick<string>(doc.excerpt) ?? '',
    metaDescription: pick<string>(doc.metaDescription) || undefined,
    focusKeyword: pick<string>(doc.focusKeyword) || undefined,
    faqs: faqs.map(({ question, answer }) => ({ question, answer })),
    body,
  }
}

function toMeta(doc: PostDoc): PostMeta {
  const cover = typeof doc.cover === 'object' ? (doc.cover as Media | null)?.url : undefined
  return {
    slug: doc.slug,
    publishedAt: (doc.publishedAt ?? doc.updatedAt).slice(0, 10),
    updatedAt: doc.updatedAt.slice(0, 10),
    author: doc.author ?? 'CargoSharks',
    tags: doc.tags ?? [],
    cover: cover ?? undefined,
    source: doc.source ?? 'human',
    en: copyIn(doc, 'en'),
    ar: copyIn(doc, 'ar'),
  }
}

async function readPosts({ draft, slug }: { draft: boolean; slug?: string }): Promise<PostMeta[]> {
  const payload = await getPayload({ config })
  const where = {
    ...(draft ? {} : { _status: { equals: 'published' } }),
    ...(slug ? { slug: { equals: slug } } : {}),
  }
  const { docs } = await payload.find({
    collection: 'posts',
    locale: 'all',
    draft,
    depth: 1,
    limit: slug ? 1 : 1000,
    sort: '-publishedAt',
    where,
  })
  return docs.map(toMeta).filter((post) => post.en || post.ar)
}

const publishedPosts = unstable_cache(() => readPosts({ draft: false }), ['blog-posts'], {
  tags: [BLOG_TAG],
  revalidate: 3600,
})

/** Every published post, newest first. */
export async function allPosts(): Promise<PostMeta[]> {
  return publishedPosts()
}

export async function postsIn(lang: Lang): Promise<PostMeta[]> {
  return (await allPosts()).filter((post) => post[lang])
}

/**
 * The blog indexes worth pointing at: each language's, once it has a post.
 * Keyed for an hreflang `languages` map, `x-default` included, so an English
 * index never names an empty Arabic one as its twin (or the reverse).
 */
export async function blogIndexAlternates(origin = ''): Promise<Record<string, string>> {
  const posts = await allPosts()
  const langs = (['en', 'ar'] as const).filter((lang) => posts.some((post) => post[lang]))
  const map: Record<string, string> = {}
  for (const lang of langs) map[lang] = `${origin}${blogPath(lang)}`
  if (langs.length) map['x-default'] = map.en ?? map.ar!
  return map
}

export function blogPath(lang: Lang, slug?: string): string {
  const base = lang === 'ar' ? '/ar/blog/' : '/blog/'
  return slug ? `${base}${slug}/` : base
}

export { renderMarkdown } from '@/lib/markdown'

export async function getMeta(slug: string, { draft = false } = {}): Promise<PostMeta | null> {
  if (draft) return (await readPosts({ draft: true, slug }))[0] ?? null
  return (await allPosts()).find((post) => post.slug === slug) ?? null
}

export async function getPost(
  slug: string,
  lang: Lang,
  { draft = false } = {},
): Promise<Post | null> {
  const meta = await getMeta(slug, { draft })
  const copy = meta?.[lang]
  if (!meta || !copy) return null
  const words = copy.body.split(/\s+/).length
  return {
    ...meta,
    lang,
    copy,
    html: renderMarkdown(copy.body),
    // ~200 words a minute, floor of one.
    readingTime: Math.max(1, Math.round(words / 200)),
  }
}
