import type { ReactNode } from 'react'
import type { ComponentType } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  CaretDown,
  ChatsCircle,
  FileText,
  Receipt,
  Stamp,
} from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { STAGGER } from '@/lib/motion'
import { DecimalsCard, FreeTimeCard, InvoiceExample } from '@/components/visuals'
import { EmailLink } from '@/components/Email'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Breadcrumbs, FaqSchema } from '@/components/StructuredData'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Section, SectionHeader } from '@/components/ui/section'
import { DEMO_URL, type Bi, type Lang } from '@/content/copy'
import { relatedCard } from '@/content/pages/solution'
import {
  AccrualStair,
  ChargeableColumns,
  ChargeWaffle,
  DutyMatrix,
  MilestoneStrips,
  MinorUnits,
} from '@/content/pages/figures'
import { LayeredRecord, OwnDatabase } from '@/content/pages/illustrations'
import { solutionPath, type Solution, type SolutionFigure } from '@/content/solutions'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * A market landing page on the rebuilt system: the Kuwait page first, and the
 * template the other ten move to once it is approved.
 *
 * The same row from `solutions.ts`, in a different order and on Tailwind and
 * shadcn/ui instead of `pages.css`. What changed, and why:
 *
 *   - **No eyebrows, no "01 · The dinar" numbering.** Every section opened with
 *     a mono label restating its own heading.
 *   - **Heading beside body, not above it.** Each section was a centred block
 *     of heading, lead and a list stretched to 1,200px in 15px type; it is a
 *     five-column heading and a seven-column body now, so the list reads at a
 *     measure and the page is about half as tall.
 *   - **A fact sheet in the masthead.** The questions a Kuwaiti buyer checks
 *     first (dinar decimals, documents, customs, e-invoicing, hosting) are
 *     answered in the first screen, from the same strings the FAQ uses.
 *   - **Sections take different shapes**, chosen by what they hold: a section
 *     with a drawn document sits beside it, alternating sides down the page;
 *     the free-time section is a dark band with a live charge line; a section
 *     of four or more points becomes a row of cards. One template repeated
 *     down the page was the other half of what made it read as generated.
 *   - **Every padding from `Section`**, every size from the type scale.
 *
 * `spec` and `extraSections` are optional fields so the row type stays the
 * same shape the old template reads; a page without them still renders.
 */
const T = {
  demo: { en: 'Open the live demo', ar: 'افتحوا النسخة التجريبية' },
  book: { en: 'Book a demo call', ar: 'احجزوا اتصالاً تعريفياً' },
  onScreen: {
    en: 'From the running demo',
    ar: 'من النسخة التجريبية العاملة',
  },
  openIt: { en: 'Open it yourself, no sign-up', ar: 'افتحوها بأنفسكم، بلا تسجيل' },
  faqHeading: { en: 'Questions asked before the demo', ar: 'أسئلة تُطرح قبل العرض' },
  faqLead: {
    en: 'Anything not answered here, ask us directly at ',
    ar: 'ما لم تجدوا جوابه هنا، اسألونا مباشرة على ',
  },
  relatedHeading: { en: 'Read next', ar: 'اقرؤوا أيضاً' },
  sources: { en: 'Sources', ar: 'المصادر' },
  checked: { en: 'Checked on ', ar: 'رُوجعت بتاريخ ' },
  checkedTail: {
    en: '. Dates set by the Ministry can move; read the Ministry’s own page before you plan against them.',
    ar: '. المواعيد التي تحددها الوزارة قد تتغير، فاقرؤوا صفحة الوزارة نفسها قبل أن تخططوا عليها.',
  },
  tailHeading: {
    en: 'See it on your own lanes.',
    ar: 'شاهدوه على خطوطكم أنتم.',
  },
  tailBody: {
    en: 'The demo is the real software on seeded data, open with no sign-up. The demo call is free, and we tailor it to your shipments.',
    ar: 'النسخة التجريبية هي البرنامج نفسه على بيانات مُعدّة، ومفتوحة بلا تسجيل. والاتصال التعريفي مجاني، ونُعدّه على شحناتكم.',
  },
} satisfies Record<string, Bi>

export function SolutionPage({
  item,
  lang,
  alternate,
}: {
  item: Solution
  lang: Lang
  alternate: string
}) {
  const home = lang === 'ar' ? '/ar/' : '/'
  // `minor` is argued by the decimals card beside its own section instead.
  const Figure = item.figure && item.figure !== 'minor' ? FIGURES[item.figure] : null
  const shot = item.shot
    ? `/pic/screens/${item.shot.file}${lang === 'ar' && !item.shot.noAr ? '-ar' : ''}.webp`
    : null

  return (
    <>
      <Header lang={lang} alternate={alternate} mark={<Wordmark tone="onDark" height={24} />} />
      <main id="top" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <Breadcrumbs
          lang={lang}
          trail={[
            {
              name: item.meta.title[lang].replace(/\s*[|—–-]\s*CargoSharks\s*$/, ''),
              path: solutionPath(item.slug, lang),
            },
          ]}
        />

        {/* Masthead: the claim and the two actions on the start side, the fact
            sheet on the end side. Dark, so the header bar sits on its own
            colour and the page's first screen matches the home page's. */}
        <section className="bg-void pt-32 pb-16 text-on-void lg:pt-36 lg:pb-20">
          <div className="shell grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-end lg:gap-16">
            <div className="lg:col-span-7">
              <h1 className="max-w-[20ch] text-balance font-display text-display font-extrabold">
                {item.title[lang]}
              </h1>
              <p className="mt-6 max-w-[58ch] text-lede text-on-void-dim">{item.lede[lang]}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href={DEMO_URL}>
                    {T.demo[lang]}
                    <ArrowRight weight="bold" className="size-4 rtl:-scale-x-100" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="onDark">
                  <a href={`${home}#demo`}>{T.book[lang]}</a>
                </Button>
              </div>
            </div>

            {item.spec ? (
              <dl className="divide-y divide-void-line border-y border-void-line lg:col-span-5">
                {item.spec.map((row) => (
                  <div key={row.label.en} className="grid grid-cols-5 gap-4 py-3.5">
                    <dt className="col-span-2 text-small text-on-void-faint">{row.label[lang]}</dt>
                    <dd className="col-span-3 text-small text-on-void">{row.value[lang]}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </section>

        {item.sections.map((section, index) => (
          <StorySection
            key={section.heading.en}
            section={section}
            lang={lang}
            // Visual sections alternate sides, counted among themselves, so
            // the page zigzags whatever the other sections are.
            flip={
              item.sections
                .slice(0, index)
                .filter((earlier) => earlier.visual && earlier.visual !== 'freetime').length %
                2 ===
              1
            }
          />
        ))}

        {/* Evidence: the running build in a bordered frame with a caption bar,
            then the drawn figure the page argues with, if it has one. */}
        {shot || Figure ? (
          <Section rule>
            <div className="shell flex flex-col gap-10">
              {shot && item.shot ? (
                <div>
                  <SectionHeader title={T.onScreen[lang]} />
                  <figure className="mt-8 overflow-hidden rounded-xl border border-line bg-paper-lift shadow-sm">
                    <img
                      src={shot}
                      alt={item.shot.alt[lang]}
                      width={2360}
                      height={1476}
                      loading="lazy"
                      decoding="async"
                      className="w-full"
                    />
                    <figcaption className="flex flex-col gap-2 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                      <span className="max-w-[80ch] text-small text-ink-dim">
                        {item.shot.look[lang]}
                      </span>
                      <a
                        href={DEMO_URL}
                        className="inline-flex shrink-0 items-center gap-1.5 text-small font-medium text-blue-ink hover:underline"
                      >
                        {T.openIt[lang]}
                        <ArrowUpRight weight="bold" className="size-3.5 rtl:-scale-x-100" />
                      </a>
                    </figcaption>
                  </figure>
                </div>
              ) : null}
              {/* Every figure is its own `ChartFigure` card. */}
              {Figure ? <Figure lang={lang} /> : null}
            </div>
          </Section>
        ) : null}

        <Section rule space="tight">
          <div className="shell grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <h2 className="text-balance font-display text-h2 font-extrabold text-heading">
                {item.limits.heading[lang]}
              </h2>
              <p className="mt-4 max-w-[40ch] text-body text-ink-dim">{item.limits.lead[lang]}</p>
            </div>
            <dl className="divide-y divide-line border-y border-line lg:col-span-7">
              {item.limits.items.map((limit) => (
                <div key={limit.label.en} className="grid gap-1 py-4 sm:grid-cols-7 sm:gap-6">
                  <dt className="text-body font-semibold text-ink sm:col-span-2">
                    {limit.label[lang]}
                  </dt>
                  <dd className="text-small text-ink-dim sm:col-span-5">{limit.body[lang]}</dd>
                </div>
              ))}
            </dl>
          </div>
          {item.sources ? (
            <div className="shell mt-10">
              <div className="rounded-lg border border-line bg-paper-lift p-5 lg:ms-[calc(41.666%+1.333rem)]">
                <p className="text-small font-semibold text-heading">{T.sources[lang]}</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {item.sources.map((source) => (
                    <li key={source.url}>
                      {/* Official pages, linked rather than paraphrased into authority. */}
                      <a
                        href={source.url}
                        rel="noopener"
                        target="_blank"
                        lang="en"
                        className="inline-flex items-start gap-1.5 text-small text-blue-ink hover:underline"
                      >
                        {source.label}
                        <ArrowUpRight weight="bold" className="mt-1 size-3 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
                {item.checked ? (
                  <p className="mt-3 text-label text-ink-faint">
                    {T.checked[lang]}
                    {item.checked}
                    {T.checkedTail[lang]}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </Section>

        {/* The questions, as `<details>` so the answers are in the HTML and
            readable without script, and the same strings `FaqSchema` marks up:
            an answer marked up but hidden from the reader is cloaking. */}
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
              {item.faq.map((entry) => (
                <details key={entry.q.en} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {entry.q[lang]}
                    <CaretDown
                      weight="bold"
                      className="size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="max-w-[64ch] pb-5 text-body text-ink-dim">{entry.a[lang]}</p>
                </details>
              ))}
            </div>
          </div>
          <FaqSchema
            items={item.faq.map((entry) => ({ question: entry.q[lang], answer: entry.a[lang] }))}
          />
        </Section>

        <Section rule space="tight">
          <div className="shell">
            <h2 className="font-display text-h3 font-bold text-heading">
              {T.relatedHeading[lang]}
            </h2>
            <ul className="mt-6 grid border-y border-line sm:grid-cols-2 lg:grid-cols-5">
              {item.related.map((target) => {
                const card = relatedCard(target, lang)
                return (
                  <li
                    key={target}
                    className="border-b border-line last:border-b-0 sm:border-e lg:border-b-0 lg:last:border-e-0"
                  >
                    <a
                      href={card.href}
                      className="group flex h-full flex-col gap-1.5 p-5 transition-colors hover:bg-paper-sunk"
                    >
                      <span className="flex items-center justify-between gap-3 text-body font-semibold text-ink">
                        {card.label}
                        <ArrowRight
                          weight="bold"
                          className="size-3.5 text-ink-faint group-hover:text-blue-ink rtl:-scale-x-100"
                        />
                      </span>
                      <span className="text-small text-ink-dim">{card.blurb}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        </Section>

        <Tail lang={lang} home={home} />
      </main>
      <Footer lang={lang} alternate={alternate} mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}

function Tail({ lang, home }: { lang: Lang; home: string }): ReactNode {
  return (
    <section className="bg-void py-14 text-on-void lg:py-16">
      <div className="shell flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-h2 font-extrabold">{T.tailHeading[lang]}</h2>
          <p className="mt-3 max-w-[60ch] text-body text-on-void-dim">{T.tailBody[lang]}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Button asChild size="lg">
            <a href={`${home}#demo`}>{T.book[lang]}</a>
          </Button>
          <Button asChild size="lg" variant="onDark">
            <a href={DEMO_URL}>{T.demo[lang]}</a>
          </Button>
        </div>
      </div>
    </section>
  )
}

type StorySectionData = Solution['sections'][number]

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

const VISUALS = { decimals: DecimalsCard, freetime: FreeTimeCard, invoice: InvoiceExample }

/** Icons for the card shape, by the point's English label. */
const POINT_ICONS: Record<string, ComponentType<{ className?: string; weight?: 'regular' }>> = {
  Enquiries: ChatsCircle,
  Customs: Stamp,
  Documents: FileText,
  Finance: Receipt,
}

const plain = (text: string) => text.replace(/[.:]$/, '')

/**
 * One section of the story, in the shape its content asks for.
 *
 *   - `freetime`: a dark band over the yard photograph, copy on the start side
 *     and the charge line still accruing beside it.
 *   - any other visual: copy beside a drawn document, flipping sides each time.
 *   - four or more points and no visual: heading and lead across the top, the
 *     points as a row of cards with an icon each.
 *   - otherwise: heading beside its body.
 */
function StorySection({
  section,
  lang,
  flip,
}: {
  section: StorySectionData
  lang: Lang
  flip: boolean
}) {
  if (section.visual === 'freetime') {
    return (
      <section className="relative isolate overflow-hidden bg-void py-16 text-on-void md:py-20">
        <img
          src="/pic/photos/containers-stack.webp"
          alt=""
          width={1600}
          height={1067}
          loading="lazy"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-void/85" />
        <div className="shell grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16">
          <Reveal className="lg:col-span-6">
            <h2 className="max-w-[20ch] text-balance font-display text-h2 font-extrabold text-on-void">
              {section.heading[lang]}
            </h2>
            {section.lead ? (
              <p className="mt-5 max-w-[56ch] text-lede text-on-void-dim">{section.lead[lang]}</p>
            ) : null}
          </Reveal>
          <Reveal className="lg:col-span-6" delay={STAGGER}>
            <FreeTimeCard lang={lang} />
          </Reveal>
        </div>
      </section>
    )
  }

  if (section.visual) {
    const Visual = VISUALS[section.visual]
    return (
      <Section rule space="tight">
        <div className="shell grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16">
          <Reveal className={flip ? 'lg:order-last lg:col-span-6' : 'lg:col-span-6'}>
            <h2 className="max-w-[20ch] text-balance font-display text-h2 font-extrabold text-heading">
              {section.heading[lang]}
            </h2>
            {section.lead ? (
              <p className="mt-5 max-w-[58ch] text-lede text-ink-dim">{section.lead[lang]}</p>
            ) : null}
            {section.points ? (
              <dl className="mt-6 flex flex-col gap-4">
                {section.points.map((point) => (
                  <div key={point.label.en} className="border-t border-line pt-4">
                    <dt className="text-body font-semibold text-heading">
                      {plain(point.label[lang])}
                    </dt>
                    <dd className="mt-0.5 text-small text-ink-dim">{point.body[lang]}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </Reveal>
          <Reveal className="min-w-0 lg:col-span-6" delay={STAGGER}>
            <Visual lang={lang} />
          </Reveal>
        </div>
      </Section>
    )
  }

  if (section.points && section.points.length >= 4) {
    return (
      <Section rule tone="sunk" space="tight">
        <div className="shell">
          <Reveal>
            <SectionHeader title={section.heading[lang]} lede={section.lead?.[lang]} />
          </Reveal>
          {/* Columns follow the count, so a row never ends with one card
              stranded: four across for four or eight, three across for five,
              six or nine. */}
          <Reveal
            className={`mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 ${
              section.points.length % 4 === 0 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
            }`}
            delay={STAGGER}
          >
            {section.points.map((point) => {
              const Icon = POINT_ICONS[plain(point.label.en)]
              return (
                <article
                  key={point.label.en}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-paper-lift p-5"
                >
                  {Icon ? (
                    <span className="flex size-10 items-center justify-center rounded-md bg-blue/8 text-blue-ink">
                      <Icon weight="regular" className="size-5" />
                    </span>
                  ) : null}
                  <h3 className="font-display text-h3 font-bold text-heading">
                    {plain(point.label[lang])}
                  </h3>
                  <p className="text-small text-ink-dim">{point.body[lang]}</p>
                </article>
              )
            })}
          </Reveal>
        </div>
      </Section>
    )
  }

  if (!section.points && !section.table && section.lead) {
    return (
      <Section rule tone="lift" space="tight">
        <Reveal className="shell">
          {/* A paragraph-only section reads as a statement: one wide column,
              the lead a step larger, on the lifted paper so it does not blend
              with the split sections either side of it. */}
          <div className="max-w-[54rem]">
            <h2 className="text-balance font-display text-h2 font-extrabold text-heading">
              {section.heading[lang]}
            </h2>
            <p className="mt-4 text-pretty text-[1.25rem] leading-[1.6] text-ink-dim">
              {section.lead[lang]}
            </p>
          </div>
        </Reveal>
      </Section>
    )
  }

  return (
    <Section rule space="tight">
      <Reveal className="shell grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-16">
        <h2 className="text-balance font-display text-h2 font-extrabold text-heading lg:col-span-5">
          {section.heading[lang]}
        </h2>
        <div className="lg:col-span-7">
          {section.lead ? (
            <p className="max-w-[62ch] text-lede text-ink-dim">{section.lead[lang]}</p>
          ) : null}
          {section.points ? (
            <dl
              className={`divide-y divide-line border-y border-line ${section.lead ? 'mt-6' : ''}`}
            >
              {section.points.map((point) => (
                <div key={point.label.en} className="grid gap-1 py-4 sm:grid-cols-7 sm:gap-6">
                  <dt className="text-body font-semibold text-heading sm:col-span-2">
                    {plain(point.label[lang])}
                  </dt>
                  <dd className="text-body text-ink-dim sm:col-span-5">{point.body[lang]}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {section.table ? (
            <div className="mt-6 overflow-hidden rounded-lg border border-line bg-paper-lift">
              <Table>
                <TableHeader>
                  <TableRow>
                    {section.table.head.map((cell) => (
                      <TableHead key={cell.en} className="first:ps-4 last:pe-4">
                        {cell[lang]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.table.rows.map(([who, appoint, live]) => (
                    <TableRow key={who.en}>
                      <TableCell className="ps-4 font-medium text-ink">{who[lang]}</TableCell>
                      <TableCell className="text-ink-dim">{appoint[lang]}</TableCell>
                      <TableCell className="pe-4 text-ink-dim">{live[lang]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      </Reveal>
    </Section>
  )
}
