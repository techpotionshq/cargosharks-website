import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ArticleSchema, Breadcrumbs, FaqSchema } from '@/components/StructuredData'
import { DEMO_URL, type Lang } from '@/content/copy'
import { blogIndexAlternates, blogPath, postsIn, type Post, type PostMeta } from '@/lib/blog'
import { pageOpenGraph } from '@/lib/og'
import { EmailLink } from '@/components/Email'

/**
 * The blog index and the post page, both languages.
 *
 * The masthead, bands and FAQ are the same markup `solution.tsx` uses, so a
 * post reads as part of the site rather than as a theme bolted onto it. The
 * one new piece is `.post__body`, the prose a Markdown file renders to —
 * styled in `pages.css` under the same `.doc-page` scope as everything else.
 */

const T = {
  kicker: { en: 'The CargoSharks blog', ar: 'مدونة CargoSharks' },
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
  read: { en: 'Read', ar: 'اقرؤوا' },
  minutes: { en: 'min read', ar: 'دقائق قراءة' },
  faqEyebrow: { en: 'Questions', ar: 'أسئلة' },
  faqHeading: { en: 'Asked about this', ar: 'أسئلة عن هذا الموضوع' },
  faqLead: {
    en: 'Anything not answered here, ask us directly at ',
    ar: 'ما لم تجدوا جوابه هنا، اسألونا مباشرة على ',
  },
  tail: {
    en: 'The fastest way to judge the software is to open it.',
    ar: 'أسرع طريقة للحكم على النظام أن تفتحوه.',
  },
  demo: { en: 'Open the live demo', ar: 'افتحوا النسخة التجريبية' },
  pilot: { en: 'Ask for a pilot', ar: 'اطلبوا تجربة' },
  all: { en: 'All posts', ar: 'كل المقالات' },
}

function date(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', {
    dateStyle: 'long',
    numberingSystem: 'latn',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

export function blogIndexMetadata(lang: Lang): Metadata {
  const path = blogPath(lang)
  return {
    title: T.metaTitle[lang],
    description: T.metaDescription[lang],
    // Until this language has a post the listing is empty, and an empty page
    // indexed now is a thin page Google remembers. Per language: posts may be
    // written in one only.
    ...(postsIn(lang).length ? {} : { robots: { index: false, follow: true } }),
    alternates: {
      canonical: path,
      languages: blogIndexAlternates(),
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
  // generate.mjs writes covers at 1280×720.
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

function Masthead({
  kicker,
  title,
  lede,
  children,
}: {
  kicker: string
  title: string
  lede: string
  children?: ReactNode
}) {
  return (
    <section className="hero hero--page">
      <div className="hero__field" aria-hidden="true">
        <div className="hero__grid" />
      </div>
      <div className="shell hero__copy">
        <p className="hero__kicker">
          <i />
          {kicker}
        </p>
        <h1 className="display">{title}</h1>
        <p className="hero__sub">{lede}</p>
        {children}
      </div>
    </section>
  )
}

export function BlogIndexContent({ posts, lang }: { posts: PostMeta[]; lang: Lang }) {
  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Breadcrumbs lang={lang} trail={[{ name: T.blog[lang], path: blogPath(lang) }]} />
      <Masthead kicker={T.kicker[lang]} title={T.title[lang]} lede={T.lede[lang]} />
      <section className="band band--paper">
        <div className="shell">
          {posts.length ? null : <p className="lead">{T.empty[lang]}</p>}
          <ul className="post-list">
            {posts.map((post) => {
              const copy = post[lang]!
              const href = blogPath(lang, post.slug)
              return (
                <li key={post.slug}>
                  <a href={href} className="post-card">
                    {post.cover ? (
                      <img src={post.cover} alt="" width={640} height={360} loading="lazy" />
                    ) : null}
                    <span className="post-card__date">
                      <time dateTime={post.publishedAt}>{date(post.publishedAt, lang)}</time>
                    </span>
                    <h2 className="h3">{copy.title}</h2>
                    <p>{copy.excerpt}</p>
                    <span className="post-card__more">{T.read[lang]} →</span>
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      </section>
    </div>
  )
}

export function PostContent({ post }: { post: Post }) {
  const { lang, copy } = post
  const path = blogPath(lang, post.slug)
  const home = lang === 'ar' ? '/ar/' : '/'

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
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

      <Masthead kicker={T.kicker[lang]} title={copy.title} lede={copy.excerpt}>
        <p className="post__meta">
          <time dateTime={post.publishedAt}>{date(post.publishedAt, lang)}</time>
          <span aria-hidden="true">·</span>
          <span>
            {post.readingTime} {T.minutes[lang]}
          </span>
        </p>
      </Masthead>

      <section className="band band--white">
        <div className="shell post">
          {post.cover ? (
            <img className="post__cover" src={post.cover} alt="" width={1280} height={720} />
          ) : null}
          <article className="post__body" dangerouslySetInnerHTML={{ __html: post.html }} />
        </div>
      </section>

      {/*
        The FAQ the model returned as data, shown as `<details>` with the same
        strings `FaqSchema` marks up — the rule `solution.tsx` keeps, for the
        same reason. The Markdown body is told not to repeat it.
      */}
      {copy.faqs.length ? (
        <section className="band band--paper">
          <div className="shell faq-wrap">
            <div className="section-head">
              <p className="eyebrow">
                <b />
                {T.faqEyebrow[lang]}
              </p>
              <h2 className="h2">{T.faqHeading[lang]}</h2>
              <p className="lead">
                {T.faqLead[lang]}
                <EmailLink />.
              </p>
            </div>
            <div className="faq">
              {copy.faqs.map((entry) => (
                <details key={entry.question}>
                  <summary>{entry.question}</summary>
                  <p>{entry.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="band band--navy">
        <div className="shell">
          <h2 className="h2">{T.tail[lang]}</h2>
          <p className="hero__ways">
            <a href={DEMO_URL}>{T.demo[lang]}</a>
            <a href={`${home}#demo`}>{T.pilot[lang]}</a>
            <a href={blogPath(lang)}>{T.all[lang]}</a>
          </p>
        </div>
      </section>
    </div>
  )
}
