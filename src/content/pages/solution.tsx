import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr'
import { Breadcrumbs, FaqSchema } from '@/components/StructuredData'
import { comparisons } from '@/content/comparisons'
import { DEMO_URL, type Bi, type Lang } from '@/content/copy'
import {
  AccrualStair,
  ChargeableColumns,
  ChargeWaffle,
  DutyMatrix,
  MilestoneStrips,
  MinorUnits,
} from '@/content/pages/figures'
import { LayeredRecord, OwnDatabase } from '@/content/pages/illustrations'
import { solution, solutionPath, type Solution, type SolutionFigure } from '@/content/solutions'
import { EmailLink } from '@/components/Email'

/**
 * One landing page, rendered from a row in `solutions.ts`.
 *
 * The same reasoning as `comparison.tsx`: ten pages that are one document with
 * different contents are one component and a table, so the shape that keeps
 * them honest (claims, then limits, then questions) cannot drift between them.
 * It uses the `.doc-page` classes so a reader clicking through from
 * `/what-we-do/` or a comparison does not cross a visual seam.
 *
 * The order is the argument:
 *
 *   masthead   what this page is for, with the demo one click away
 *   sections   what the product does for this reader, as mechanisms
 *   evidence   a real capture and a drawn figure the other pages already carry
 *   limits     what it does not do, on the same page as the claims
 *   sources    only where the page states somebody else's facts
 *   questions  the FAQ, visible, and the same strings `FaqSchema` marks up
 *   next       related pages, then the close
 *
 * **The `dir` wrapper is load-bearing.** Every right-to-left rule in
 * `pages.css` is written `.doc-page [dir='rtl'] …`, which only matches an
 * element *inside* `<main class="doc-page">` carrying the attribute. The
 * document's own `dir` is on `<html>`, an ancestor, so without this wrapper
 * the Arabic pages would get the Latin font stack, Latin heading leading and
 * arrows pointing the wrong way.
 */

const FIGURES: Record<SolutionFigure, (props: { lang: Lang }) => ReactNode> = {
  chargeable: ChargeableColumns,
  waffle: ChargeWaffle,
  accrual: AccrualStair,
  milestones: MilestoneStrips,
  minor: MinorUnits,
  layered: LayeredRecord,
  own: OwnDatabase,
  duty: DutyMatrix,
}

const T = {
  demo: { en: 'Open the live demo', ar: 'افتحوا النسخة التجريبية' },
  pilot: { en: 'Ask for a pilot', ar: 'اطلبوا تجربة' },
  whatWeDo: { en: 'What the product does', ar: 'ماذا يفعل المنتج' },
  compare: { en: 'How we compare', ar: 'كيف نقارن' },
  onScreen: { en: 'On the screen', ar: 'على الشاشة' },
  onScreenHeading: {
    en: 'The screen, from the running demo',
    ar: 'الشاشة، من النسخة التجريبية العاملة',
  },
  openIt: { en: 'Open it yourself', ar: 'افتحوها بأنفسكم' },
  noSignUp: { en: ', no sign-up.', ar: '، بلا تسجيل.' },
  limitsEyebrow: { en: 'The boundary', ar: 'الحدود' },
  sourcesHeading: { en: 'Sources', ar: 'المصادر' },
  checked: { en: 'Checked on ', ar: 'رُوجعت بتاريخ ' },
  checkedTail: {
    en: '. Dates set by the Ministry can move; read the Ministry’s own page before you plan against them.',
    ar: '. المواعيد التي تحددها الوزارة قد تتغير، فاقرؤوا صفحة الوزارة نفسها قبل أن تخططوا عليها.',
  },
  faqEyebrow: { en: 'Questions', ar: 'أسئلة' },
  faqHeading: { en: 'Asked before the demo', ar: 'تُطرح قبل النسخة التجريبية' },
  faqLead: {
    en: 'Anything not answered here, ask us directly at ',
    ar: 'ما لم تجدوا جوابه هنا، اسألونا مباشرة على ',
  },
  relatedEyebrow: { en: 'Read next', ar: 'اقرؤوا أيضاً' },
  relatedHeading: { en: 'Related pages', ar: 'صفحات ذات صلة' },
  tailHeading: {
    en: 'The fastest way to judge this is to open it.',
    ar: 'أسرع طريقة للحكم عليه أن تفتحوه.',
  },
  tailBody: {
    en: 'The demo is the real software on seeded data, with sign-ins for you, your customer and your agent. Nothing you do in it touches anything.',
    ar: 'النسخة التجريبية هي البرنامج نفسه على بيانات مُعدّة، بحسابات لكم ولعميلكم ولوكيلكم. ولا يمسّ ما تفعلونه فيها شيئاً.',
  },
} satisfies Record<string, Bi>

/** A related link resolves to a card: a solution row, a comparison row, or one of the overview pages. */
function relatedCard(target: string, lang: Lang): { href: string; label: string; blurb: string } {
  if (!target.startsWith('/')) {
    const row = solution(target)
    return {
      href: solutionPath(row.slug, lang),
      label: row.nav.label[lang],
      blurb: row.nav.blurb[lang],
    }
  }

  const compared = comparisons.find((item) => `/compare/${item.slug}/` === target)
  if (compared) {
    return {
      href: target,
      label: lang === 'ar' ? `مقابل ${compared.name}` : `vs ${compared.name}`,
      blurb: compared.title[lang],
    }
  }

  // The overview pages have no Arabic twin; an Arabic reader is sent to the
  // English page, labelled in Arabic, which is what the header already does.
  const overview: Record<string, { label: Bi; blurb: Bi }> = {
    '/what-we-do/': {
      label: { en: 'What we do', ar: 'ماذا نفعل' },
      blurb: {
        en: 'The whole product, explained from the beginning',
        ar: 'المنتج كاملاً، مشروحاً من البداية (بالإنجليزية)',
      },
    },
    '/compare/': {
      label: { en: 'How we compare', ar: 'كيف نقارن' },
      blurb: {
        en: 'Three ways to run an operation, and who we are not for',
        ar: 'ثلاث طرق لإدارة العمل، ومن لسنا لهم (بالإنجليزية)',
      },
    },
  }
  const page = overview[target]
  if (!page) throw new Error(`Related link "${target}" is not a known page`)
  return { href: target, label: page.label[lang], blurb: page.blurb[lang] }
}

export function SolutionContent({ item, lang }: { item: Solution; lang: Lang }) {
  const Figure = item.figure ? FIGURES[item.figure] : null
  const home = lang === 'ar' ? '/ar/' : '/'

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Home → this page. The name is the search title without the brand
          suffix, which is the short form a results page shows. */}
      <Breadcrumbs
        lang={lang}
        trail={[
          {
            name: item.meta.title[lang].replace(/\s*[|—–-]\s*CargoSharks\s*$/, ''),
            path: solutionPath(item.slug, lang),
          },
        ]}
      />
      {/* The masthead, the same markup `comparison.tsx` and `what-we-do.tsx` use. */}
      <section className="hero hero--page">
        <div className="hero__field" aria-hidden="true">
          <div className="hero__grid" />
        </div>
        <div className="shell hero__copy">
          <p className="hero__kicker">
            <i />
            {item.kicker[lang]}
          </p>
          <h1 className="display">{item.title[lang]}</h1>
          <p className="hero__sub">{item.lede[lang]}</p>
          <p className="hero__ways">
            <a href={DEMO_URL}>{T.demo[lang]}</a>
            <a href={`${home}#pilot`}>{T.pilot[lang]}</a>
            <a href="/what-we-do/">{T.whatWeDo[lang]}</a>
            <a href="/compare/">{T.compare[lang]}</a>
          </p>
        </div>
      </section>

      {item.sections.map((section, index) => (
        <section
          key={section.heading.en}
          className={`band ${index % 2 === 0 ? 'band--paper' : 'band--white'}`}
        >
          <div className="shell">
            <div className="section-head">
              <p className="eyebrow">
                <b />
                {section.eyebrow[lang]}
              </p>
              <h2 className="h2">{section.heading[lang]}</h2>
              {section.lead ? <p className="lead">{section.lead[lang]}</p> : null}
            </div>

            {section.points ? (
              <ul className="feature-list">
                {section.points.map((point) => (
                  <li key={point.label.en}>
                    <b>{point.label[lang]}</b> {point.body[lang]}
                  </li>
                ))}
              </ul>
            ) : null}

            {section.table ? (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      {section.table.head.map((cell) => (
                        <th key={cell.en} scope="col">
                          {cell[lang]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map(([who, appoint, live]) => (
                      <tr key={who.en}>
                        <th scope="row">{who[lang]}</th>
                        <td>{appoint[lang]}</td>
                        <td>{live[lang]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      ))}

      {/*
        Evidence: a capture of the running build and a figure the site already
        draws. Neither is decoration; both are the thing the sections above
        describe, and the caption says what to look at.
      */}
      {item.shot || Figure ? (
        <section className="band band--white">
          <div className="shell">
            {item.shot ? (
              <>
                <div className="section-head">
                  <p className="eyebrow">
                    <b />
                    {T.onScreen[lang]}
                  </p>
                  <h2 className="h2">{T.onScreenHeading[lang]}</h2>
                </div>
                <figure className="cmp-figure">
                  <div className="frame">
                    <img
                      src={`/pic/screens/${item.shot.file}${lang === 'ar' && !item.shot.noAr ? '-ar' : ''}.webp`}
                      alt={item.shot.alt[lang]}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <figcaption>
                    {item.shot.look[lang]} <a href={DEMO_URL}>{T.openIt[lang]}</a>
                    {T.noSignUp[lang]}
                  </figcaption>
                </figure>
              </>
            ) : null}
            {Figure ? <Figure lang={lang} /> : null}
          </div>
        </section>
      ) : null}

      <section className="band band--paper">
        <div className="shell">
          <div className="section-head">
            <p className="eyebrow">
              <b />
              {T.limitsEyebrow[lang]}
            </p>
            <h2 className="h2">{item.limits.heading[lang]}</h2>
            <p className="lead">{item.limits.lead[lang]}</p>
          </div>
          <ul className="notfor">
            {item.limits.items.map((limit) => (
              <li key={limit.label.en}>
                <span>
                  <b>{limit.label[lang]}</b>
                  <small>{limit.body[lang]}</small>
                </span>
              </li>
            ))}
          </ul>

          {item.sources ? (
            <div className="sourced">
              <p>
                <b>{T.sourcesHeading[lang]}</b>
              </p>
              {item.sources.map((source) => (
                <p key={source.url}>
                  {/* Official pages, linked rather than paraphrased into authority. */}
                  <a href={source.url} rel="noopener" target="_blank" lang="en">
                    {source.label}
                    <ArrowUpRight
                      weight="bold"
                      style={{ display: 'inline', width: '0.8em', height: '0.8em' }}
                    />
                  </a>
                </p>
              ))}
              {item.checked ? (
                <p>
                  {T.checked[lang]}
                  {item.checked}
                  {T.checkedTail[lang]}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/*
        The questions, as `<details>` so they are on the page and readable, and
        the same strings handed to `FaqSchema`. Marking up an answer a visitor
        cannot find is cloaking; these are both views of one array.
      */}
      <section className="band band--white">
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
            {item.faq.map((entry) => (
              <details key={entry.q.en}>
                <summary>{entry.q[lang]}</summary>
                <p>{entry.a[lang]}</p>
              </details>
            ))}
          </div>
        </div>
        <FaqSchema
          items={item.faq.map((entry) => ({ question: entry.q[lang], answer: entry.a[lang] }))}
        />
      </section>

      <section className="band band--paper">
        <div className="shell">
          <div className="section-head">
            <p className="eyebrow">
              <b />
              {T.relatedEyebrow[lang]}
            </p>
            <h2 className="h2">{T.relatedHeading[lang]}</h2>
          </div>
          <div className="grid grid--3 sol-related">
            {item.related.map((target) => {
              const card = relatedCard(target, lang)
              return (
                <a key={target} className="card" href={card.href}>
                  <h3>{card.label}</h3>
                  <p>{card.blurb}</p>
                </a>
              )
            })}
          </div>
        </div>
      </section>

      <section className="band tail">
        <div className="shell">
          <div>
            <h2>{T.tailHeading[lang]}</h2>
            <p>{T.tailBody[lang]}</p>
          </div>
          <div className="tail__actions">
            <a className="btn btn--primary" href={DEMO_URL}>
              {T.demo[lang]}
            </a>
            <a className="btn btn--ghost" href={`${home}#pilot`}>
              {T.pilot[lang]}
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * Metadata for one landing page in one language, derived from its row.
 *
 * The comparison routes write theirs out as literals, which is fine for four
 * pages in one language. Twenty routes would be twenty copies of a title that
 * also lives in `solutions.ts`, and the copy in the `<head>` is the one nobody
 * looks at when the heading changes. So the route asks for it instead.
 *
 * Every page declares both languages under `alternates.languages`, which is
 * what emits the `hreflang` pair and stops `/x/` and `/ar/x/` competing for the
 * same query. `openGraph` is set in full because Next merges metadata
 * shallowly: a page that sets none inherits the layout's, and the layout's is
 * the home page's title.
 */
export function solutionMetadata(slug: string, lang: Lang): Metadata {
  const item = solution(slug)
  const path = solutionPath(slug, lang)
  const shot = item.shot
    ? `/pic/screens/${item.shot.file}${lang === 'ar' && !item.shot.noAr ? '-ar' : ''}.webp`
    : lang === 'ar'
      ? '/pic/screens/app-dashboard-ar.webp'
      : '/pic/screens/app-dashboard.webp'

  return {
    title: item.meta.title[lang],
    description: item.meta.description[lang],
    alternates: {
      canonical: path,
      languages: {
        en: solutionPath(slug, 'en'),
        ar: solutionPath(slug, 'ar'),
        'x-default': solutionPath(slug, 'en'),
      },
    },
    openGraph: {
      type: 'article',
      locale: lang,
      alternateLocale: lang === 'ar' ? 'en' : 'ar',
      siteName: 'CargoSharks',
      title: item.meta.title[lang],
      description: item.meta.description[lang],
      url: path,
      images: [{ url: shot }],
    },
  }
}
