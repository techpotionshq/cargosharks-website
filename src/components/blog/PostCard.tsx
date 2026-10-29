import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import type { Lang } from '@/content/copy'
import { blogPath, type PostMeta } from '@/lib/blog'
import { cn } from '@/lib/utils'

const T = {
  minutes: { en: 'min read', ar: 'دقائق قراءة' },
  read: { en: 'Read the post', ar: 'اقرؤوا المقال' },
}

export function postDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', {
    dateStyle: 'long',
    numberingSystem: 'latn',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

/** Minutes to read a post's body, as the post page reckons it (200 words a minute). */
export const readingMinutes = (body: string) =>
  Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200))

/** "12 March 2026 · 6 min read", the one line of metadata a card and a post carry. */
export function PostMetaLine({
  iso,
  minutes,
  lang,
  className,
}: {
  iso: string
  minutes: number
  lang: Lang
  className?: string
}) {
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 text-label', className)}>
      <time dateTime={iso}>{postDate(iso, lang)}</time>
      <span aria-hidden="true">·</span>
      <span>
        {minutes} {T.minutes[lang]}
      </span>
    </p>
  )
}

/**
 * One post as a card, on the index and under every post.
 *
 * The photograph runs to the card's edges and the text sits below it: the
 * cover is the strongest thing a post has. Title and excerpt are clamped so a
 * row of cards ends level whatever the model wrote, and a post with no cover
 * gets a quiet panel rather than a hole. `featured` lays the newest post out
 * wide, picture beside text, above the grid.
 */
export function PostCard({
  post,
  lang,
  featured = false,
}: {
  post: PostMeta
  lang: Lang
  featured?: boolean
}) {
  const copy = post[lang]!
  const Title = featured ? 'h2' : 'h3'
  return (
    <a
      href={blogPath(lang, post.slug)}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-paper-lift transition-colors hover:border-line-strong',
        featured && 'lg:grid lg:grid-cols-12',
      )}
    >
      <span
        className={cn(
          'block aspect-video overflow-hidden border-b border-line bg-paper-sunk',
          featured && 'lg:col-span-7 lg:aspect-auto lg:min-h-full lg:border-e lg:border-b-0',
        )}
      >
        {post.cover ? (
          <img
            src={post.cover}
            alt=""
            width={1280}
            height={720}
            loading={featured ? 'eager' : 'lazy'}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : null}
      </span>
      <span
        className={cn(
          'flex flex-1 flex-col gap-3 p-5 sm:p-6',
          featured && 'lg:col-span-5 lg:justify-center lg:p-10',
        )}
      >
        <PostMetaLine
          iso={post.publishedAt}
          minutes={readingMinutes(copy.body)}
          lang={lang}
          className="text-ink-faint"
        />
        <Title
          className={cn(
            'text-balance font-display text-heading',
            featured ? 'text-h2 font-extrabold' : 'line-clamp-3 text-h3 font-bold',
          )}
        >
          {copy.title}
        </Title>
        <p
          className={cn(
            'text-pretty text-ink-dim',
            featured ? 'text-body' : 'line-clamp-3 text-small',
          )}
        >
          {copy.excerpt}
        </p>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-small font-semibold text-blue-ink">
          {T.read[lang]}
          <ArrowRight
            weight="bold"
            className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
          />
        </span>
      </span>
    </a>
  )
}
