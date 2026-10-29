import type { Metadata } from 'next'
import { ArrowLeft, ArrowRight, CaretDown } from '@phosphor-icons/react/dist/ssr'
import { ArticleSchema, Breadcrumbs, FaqSchema } from '@/components/StructuredData'
import { BlogMasthead } from '@/components/blog/BlogFrame'
import { PostCard, PostMetaLine } from '@/components/blog/PostCard'
import '@/components/blog/post-body.css'
import { EmailLink } from '@/components/Email'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { DEMO_URL, type Lang } from '@/content/copy'
import { blogIndexAlternates, blogPath, postsIn, type Post, type PostMeta } from '@/lib/blog'
import { pageOpenGraph } from '@/lib/og'

/**
 * The blog index and the post page, both languages.
 *
 * On the design system the market pages use: a dark masthead, every band a
 * `Section`, sizes from the type scale. The pieces are in
 * `src/components/blog/`; the prose a Markdown body renders to is styled in
 * `post-body.css` beside them, because it is the one markup on the site not
 * written by hand.
 */

const T = {
  title: {
    en: 'Notes on running a Gulf forwarding desk',
    ar: 'ملاحظات عن إدارة مكتب شحن في الخليج',
  },
  lede: {
    en: 'Quoting, customs, free time, documents and getting paid: what the work involves, written for the people who do it.',
    ar: 'عروض الأسعار والتخليص وفترات السماح والمستندات والتحصيل: ما يتطلبه العمل، مكتوباً لمن يقومون به.',
  },
  metaTitle: {
    en: 'Blog — freight forwarding in Kuwait and the Gulf | CargoSharks',
    ar: 'المدونة — الشحن والتخليص في الكويت والخليج | CargoSharks',
  },
  metaDescription: {
    en: 'Practical writing for freight forwarders and customs brokers in Kuwait, the UAE and Saudi Arabia: quoting, customs, demurrage, e-invoicing and documents.',
    ar: 'كتابات عملية لشركات الشحن والتخليص في الكويت والإمارات والسعودية: عروض الأسعار والتخليص والغرامات والفوترة الإلكترونية والمستندات.',
  },
  blog: { en: 'Blog', ar: 'المدونة' },
  empty: {
    en: 'The first posts are on their way.',
    ar: 'أولى المقالات في الطريق.',
  },
  emptyBody: {
    en: 'Until then, the market pages cover how the software handles Kuwait, the UAE and Saudi Arabia.',
    ar: 'وإلى ذلك الحين، تشرح صفحات الأسواق كيف يعمل النظام في الكويت والإمارات والسعودية.',
  },
  kuwait: { en: 'Freight forwarding software for Kuwait', ar: 'برنامج الشحن للكويت' },
  more: { en: 'More from the blog', ar: 'المزيد من المدونة' },
  photoBy: { en: 'Photo by', ar: 'تصوير' },
  onPexels: { en: 'on Pexels', ar: 'على Pexels' },
  faqHeading: { en: 'Asked about this', ar: 'أسئلة عن هذا الموضوع' },
  faqLead: {
    en: 'Anything not answered here, ask us directly at ',
    ar: 'ما لم تجدوا جوابه هنا، اسألونا مباشرة على ',
  },
  tail: {
    en: 'See it on your own shipments.',
    ar: 'شاهدوه على شحناتكم أنتم.',
  },
  tailBody: {
    en: 'The demo call is free, and we tailor it to your lanes. The live demo is open now, with no sign-up.',
    ar: 'الاتصال التعريفي مجاني، ونُعدّه على خطوطكم. والنسخة التجريبية مفتوحة الآن، بلا تسجيل.',
  },
  demo: { en: 'Open the live demo', ar: 'افتحوا النسخة التجريبية' },
  book: { en: 'Book a demo', ar: 'احجزوا عرضاً تعريفياً' },
  all: { en: 'All posts', ar: 'كل المقالات' },
}

export async function blogIndexMetadata(lang: Lang): Promise<Metadata> {
  const path = blogPath(lang)
  const [posts, languages] = await Promise.all([postsIn(lang), blogIndexAlternates()])
  return {
    title: T.metaTitle[lang],
    description: T.metaDescription[lang],
    // Until this language has a post the listing is empty, and an empty page
    // indexed now is a thin page Google remembers. Per language: posts may be
    // written in one only.
    ...(posts.length ? {} : { robots: { index: false, follow: true } }),
    alternates: {
      canonical: path,
      languages,
      types: { 'application/rss+xml': '/blog/feed.xml' },
    },
    openGraph: pageOpenGraph({
      path,
      title: T.metaTitle[lang],
      description: T.metaDescription[lang],
      lang,
    }),
  }
}

/** From `PostMeta` alone, so building a page's metadata never parses its body. */
export function postMetadata(post: PostMeta, lang: Lang): Metadata {
  const copy = post[lang]!
  const path = blogPath(lang, post.slug)
  const description = copy.metaDescription || copy.excerpt
  const languages: Record<string, string> = {}
  if (post.en) languages.en = blogPath('en', post.slug)
  if (post.ar) languages.ar = blogPath('ar', post.slug)
  languages['x-default'] = blogPath(post.en ? 'en' : 'ar', post.slug)
  const og = pageOpenGraph({ path, title: copy.title, description, lang, type: 'article' })
  // The generator makes covers at 1280×720.
  const images = post.cover ? [{ url: post.cover, width: 1280, height: 720 }] : og.images

  return {
    title: `${copy.title} | CargoSharks`,
    description,
    alternates: { canonical: path, languages },
    openGraph: {
      ...og,
      type: 'article',
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      tags: post.tags,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.title,
      description,
      images: [
        post.cover ??
          (lang === 'ar'
            ? '/pic/screens/app-dashboard-ar.webp'
            : '/pic/screens/app-dashboard.webp'),
      ],
    },
  }
}

const homeOf = (lang: Lang) => (lang === 'ar' ? '/ar/' : '/')

/** A grid of post cards: one column on a phone, two on a tablet, three wide. */
function PostGrid({ posts, lang }: { posts: PostMeta[]; lang: Lang }) {
  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <li key={post.slug} className="min-w-0">
          <PostCard post={post} lang={lang} />
        </li>
      ))}
    </ul>
  )
}

export function BlogIndexContent({ posts, lang }: { posts: PostMeta[]; lang: Lang }) {
  const [newest, ...rest] = posts
  return (
    <>
      <Breadcrumbs lang={lang} trail={[{ name: T.blog[lang], path: blogPath(lang) }]} />
      <BlogMasthead title={T.title[lang]} lede={T.lede[lang]} />

      <Section>
        <div className="shell flex flex-col gap-10 lg:gap-12">
          {newest ? (
            <PostCard post={newest} lang={lang} featured />
          ) : (
            // The listing is empty until a language has its first post. Say so
            // plainly and point somewhere useful rather than leave a blank band.
            <div className="rounded-lg border border-line bg-paper-lift p-6 sm:p-10">
              <h2 className="font-display text-h3 font-bold text-heading">{T.empty[lang]}</h2>
              <p className="mt-3 max-w-[60ch] text-body text-ink-dim">{T.emptyBody[lang]}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <a
                    href={
                      lang === 'ar'
                        ? '/ar/freight-forwarding-software-kuwait/'
                        : '/freight-forwarding-software-kuwait/'
                    }
                  >
                    {T.kuwait[lang]}
                  </a>
                </Button>
                <Button asChild>
                  <a href={`${homeOf(lang)}#demo`}>{T.book[lang]}</a>
                </Button>
              </div>
            </div>
          )}
          {rest.length ? <PostGrid posts={rest} lang={lang} /> : null}
        </div>
      </Section>

      <Tail lang={lang} />
    </>
  )
}

export function PostContent({ post, more = [] }: { post: Post; more?: PostMeta[] }) {
  const { lang, copy } = post
  const path = blogPath(lang, post.slug)

  return (
    <>
      <Breadcrumbs
        lang={lang}
        trail={[
          { name: T.blog[lang], path: blogPath(lang) },
          { name: copy.title, path },
        ]}
      />
      <ArticleSchema
        path={path}
        lang={lang}
        title={copy.title}
        description={copy.metaDescription || copy.excerpt}
        image={post.cover}
        publishedAt={post.publishedAt}
        updatedAt={post.updatedAt}
        author={post.author}
        tags={post.tags}
      />
      {copy.faqs.length ? <FaqSchema items={copy.faqs} /> : null}

      <BlogMasthead
        title={copy.title}
        lede={copy.excerpt}
        before={
          <a
            href={blogPath(lang)}
            className="mb-6 inline-flex min-h-10 items-center gap-1.5 text-small font-medium text-blue-lit hover:text-on-void"
          >
            <ArrowLeft weight="bold" className="size-3.5 rtl:-scale-x-100" />
            {T.blog[lang]}
          </a>
        }
        after={
          <PostMetaLine
            iso={post.publishedAt}
            minutes={post.readingTime}
            lang={lang}
            className="mt-6 text-on-void-faint"
          />
        }
      />

      <Section>
        <div className="shell">
          {post.cover ? (
            <figure className="mb-10 max-w-4xl lg:mb-12">
              <img
                src={post.cover}
                alt=""
                width={1280}
                height={720}
                className="w-full rounded-lg border border-line"
              />
              {/* Pexels asks for this, and a named photographer reads as a
                  real photograph rather than an illustration. */}
              {post.coverCredit ? (
                <figcaption className="mt-3 text-label text-ink-faint">
                  {T.photoBy[lang]}{' '}
                  {post.coverCredit.url ? (
                    <a
                      href={post.coverCredit.url}
                      rel="noopener nofollow"
                      className="underline underline-offset-2 hover:text-ink"
                    >
                      {post.coverCredit.name}
                    </a>
                  ) : (
                    post.coverCredit.name
                  )}{' '}
                  {T.onPexels[lang]}
                </figcaption>
              ) : null}
            </figure>
          ) : null}
          <article className="post-body" dangerouslySetInnerHTML={{ __html: post.html }} />
        </div>
      </Section>

      {/*
        The FAQ the model returned as data, shown as `<details>` with the same
        strings `FaqSchema` marks up: an answer marked up but hidden from the
        reader is cloaking. The Markdown body is told not to repeat it.
      */}
      {copy.faqs.length ? (
        <Section rule tone="lift">
          <div className="shell grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <h2 className="text-balance font-display text-h2 font-extrabold text-heading">
                {T.faqHeading[lang]}
              </h2>
              <p className="mt-4 max-w-[40ch] text-body text-ink-dim">
                {T.faqLead[lang]}
                <EmailLink className="text-blue-ink hover:underline" />.
              </p>
            </div>
            <div className="divide-y divide-line border-y border-line lg:col-span-7">
              {copy.faqs.map((entry) => (
                <details key={entry.question} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {entry.question}
                    <CaretDown
                      weight="bold"
                      className="size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    />
                  </summary>
                  <p className="max-w-[64ch] pb-5 text-body text-ink-dim">{entry.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </Section>
      ) : null}

      {/* Three more posts, so a reader who finished this one has somewhere to
          go other than the back button. Newest first, this one left out. */}
      {more.length ? (
        <Section rule tone="sunk" space="tight">
          <div className="shell">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-display text-h2 font-extrabold text-heading">{T.more[lang]}</h2>
              <a
                href={blogPath(lang)}
                className="inline-flex min-h-10 items-center gap-1.5 text-small font-semibold text-blue-ink hover:underline"
              >
                {T.all[lang]}
                <ArrowRight weight="bold" className="size-3.5 rtl:-scale-x-100" />
              </a>
            </div>
            <PostGrid posts={more} lang={lang} />
          </div>
        </Section>
      ) : null}

      <Tail lang={lang} />
    </>
  )
}

/** The close every blog page ends on: book a demo, or open the live one. */
function Tail({ lang }: { lang: Lang }) {
  return (
    <section className="bg-void py-14 text-on-void lg:py-16">
      <div className="shell flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-h2 font-extrabold">{T.tail[lang]}</h2>
          <p className="mt-3 max-w-[60ch] text-body text-on-void-dim">{T.tailBody[lang]}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Button asChild size="lg">
            <a href={`${homeOf(lang)}#demo`}>{T.book[lang]}</a>
          </Button>
          <Button asChild size="lg" variant="onDark">
            <a href={DEMO_URL}>{T.demo[lang]}</a>
          </Button>
        </div>
      </div>
    </section>
  )
}
