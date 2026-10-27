import { resolveBrand } from '@qabandi/brand'
import { DEMO_URL } from '@/content/copy'

/**
 * JSON-LD, and why it is worth the bytes on a nine-page site.
 *
 * Two things read this and neither is a person. A search engine uses it to
 * decide what kind of thing a page is — a product, an organisation, a step in a
 * hierarchy — which is the difference between a result that shows a title and
 * one that shows a title, a breadcrumb and a rating. And an assistant asked
 * "what freight software is there in Kuwait" reads it to answer, which for a
 * product in this market is now a real channel rather than a curiosity.
 *
 * **Every value here comes from somewhere else.** The company name, the legal
 * name, the founding year and the logo are `@qabandi/brand`; the addresses are
 * `copy.ts`. A structured-data block with its own copy of the company name is a
 * second place for a rebrand to be forgotten, and it is the *machine-readable*
 * copy, so nobody would notice for a year.
 *
 * `dangerouslySetInnerHTML` is the documented way to emit a JSON-LD script.
 * Nothing in it comes from a visitor, but blog headlines and FAQ answers come
 * from a model, and `JSON.stringify` leaves `<` alone: an answer containing
 * `</script>` would close the block and run whatever followed on every post
 * page. `Ld` writes every `<` as the JSON escape `\u003c`, which is the same
 * string to a JSON parser and no tag to an HTML one.
 */

export const SITE_URL = 'https://cargosharks.com'

function Ld({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Not indented: this is machine-read, and the whitespace is pure payload.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}

/**
 * The company, for a node that names it as publisher.
 *
 * Inline rather than `{ '@id': '/#organization' }`: that node is only on the
 * home pages, and a rich-results parser resolves `@id` within the page, so a
 * post's publisher would have no name and no logo.
 */
function publisher() {
  const brand = resolveBrand()
  return {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: brand.identity.nameEn,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/cargosharks-logo/png/cargosharks-mark-light-512.png`,
    },
  }
}

/**
 * The company and the product, on the home page only.
 *
 * `Organization` and `SoftwareApplication` are separate nodes joined by
 * `publisher`, rather than one node claiming to be both. A search engine that
 * is told a single entity is a company and an application resolves neither.
 */
export function SiteSchema({ lang }: { lang: 'en' | 'ar' }) {
  const brand = resolveBrand()
  const home = lang === 'ar' ? `${SITE_URL}/ar/` : `${SITE_URL}/`

  return (
    <>
      <Ld
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          '@id': `${SITE_URL}/#organization`,
          name: brand.identity.nameEn,
          alternateName: brand.identity.nameAr,
          legalName: brand.identity.legalNameEn,
          url: SITE_URL,
          logo: `${SITE_URL}/cargosharks-logo/png/cargosharks-mark-light-512.png`,
          foundingDate: brand.identity.established,
          // No `email`. It would be the one whole address in the HTML, and no
          // search feature uses it; see components/Email.tsx.
          address: {
            '@type': 'PostalAddress',
            addressCountry: 'KW',
            addressLocality: 'Kuwait City',
          },
          areaServed: [
            { '@type': 'Country', name: 'Kuwait' },
            { '@type': 'Country', name: 'United Arab Emirates' },
            { '@type': 'Country', name: 'Saudi Arabia' },
          ],
        }}
      />
      <Ld
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          '@id': `${SITE_URL}/#software`,
          name: brand.identity.nameEn,
          applicationCategory: 'BusinessApplication',
          applicationSubCategory: 'Freight forwarding and customs brokerage software',
          operatingSystem: 'Web browser',
          url: home,
          inLanguage: ['en', 'ar'],
          publisher: { '@id': `${SITE_URL}/#organization` },
          /*
            No `aggregateRating` and no `offers`. Both are the fields that get a
            rich result, and both would be invented — the product is in pilot,
            so there are no ratings, and pricing is not published. Marking up a
            rating you do not have is the one SEO decision that can get a domain
            penalised rather than merely ignored.
          */
          featureList: [
            'Bilingual Arabic and English interface and documents',
            'Sea, air, road and courier',
            'Rate cards by lane, mode and carrier',
            'Milestones with planned, revised and actual times',
            'Free-time and demurrage tracking',
            'Customs status and document issue',
            'Costs, supplier invoice matching and receivables',
          ],
        }}
      />
    </>
  )
}

/**
 * The trail from the home page to here.
 *
 * Rendered inside the page rather than the layout because only the pages that
 * are actually nested want one — a breadcrumb on a top-level page is a trail of
 * length one, which is noise a search engine has to discard.
 */
export function Breadcrumbs({
  trail,
  lang = 'en',
}: {
  trail: { name: string; path: string }[]
  /** An Arabic page's trail starts at the Arabic home page, named in Arabic. */
  lang?: 'en' | 'ar'
}) {
  const home = lang === 'ar' ? { name: 'الرئيسية', path: '/ar/' } : { name: 'Home', path: '/' }
  return (
    <Ld
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [home, ...trail].map((step, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: step.name,
          item: `${SITE_URL}${step.path}`,
        })),
      }}
    />
  )
}

/**
 * A question-and-answer block, for the comparison pages' §04.
 *
 * `FAQPage` is the one schema on this site with a direct, visible payoff: the
 * questions can appear under the result. It is only ever emitted where the same
 * questions and answers are on the page in readable text — marking up an answer
 * a visitor cannot find is cloaking, and it is checked by hand rather than
 * generated from a different source for exactly that reason.
 */
export function FaqSchema({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <Ld
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      }}
    />
  )
}

/**
 * One blog post. `publisher` points at the home page's `Organization` node by
 * `@id` rather than repeating it, so the company is described once on the site
 * and every article attaches to that one entity.
 */
export function ArticleSchema({
  path,
  lang,
  title,
  description,
  image,
  publishedAt,
  updatedAt,
  author,
  tags,
}: {
  path: string
  lang: 'en' | 'ar'
  title: string
  description: string
  image?: string
  publishedAt: string
  updatedAt?: string
  author: string
  tags: string[]
}) {
  return (
    <Ld
      data={{
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        '@id': `${SITE_URL}${path}#article`,
        mainEntityOfPage: `${SITE_URL}${path}`,
        headline: title,
        description,
        inLanguage: lang,
        datePublished: publishedAt,
        dateModified: updatedAt ?? publishedAt,
        ...(image ? { image: `${SITE_URL}${image}` } : {}),
        author: { '@type': 'Organization', name: author, url: SITE_URL },
        publisher: publisher(),
        ...(tags.length ? { keywords: tags.join(', ') } : {}),
      }}
    />
  )
}

/** The demo, so an assistant asked "can I try it" has the URL. */
export const DEMO_ENTRY = DEMO_URL
