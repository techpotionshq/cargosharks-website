import type { ComponentType } from 'react'
import {
  ArrowRight,
  ArrowsClockwise,
  CaretDown,
  CheckCircle,
  Handshake,
  PlusCircle,
  Wrench,
} from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { EmailLink } from '@/components/Email'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { LeadForm } from '@/components/LeadForm'
import { Breadcrumbs, FaqSchema } from '@/components/StructuredData'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Section, SectionHeader } from '@/components/ui/section'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DEMO_URL, type Lang } from '@/content/copy'
import { pricing, pricingPath } from '@/content/pricing'
import { STAGGER } from '@/lib/motion'

/**
 * `/pricing/` and `/ar/pricing/`: how a quote is built, then the form that
 * asks for one. Copy and the reasoning behind it are in `content/pricing.ts`.
 *
 * The order is the visitor's: what this is and the two things to do (masthead),
 * what happens after they ask (steps), what a quote is made of (the bill), what
 * moves it (the table), what the product includes and what is added (scope),
 * the form, and the questions left over.
 *
 * Each section takes a different shape on purpose — a numbered strip, cards,
 * a table, a dark band of two lists — because one heading-beside-body template
 * repeated down a page reads as generated. Every padding comes from `Section`
 * and every size from the type scale, as on the market pages.
 *
 * The form's section is `#quote`, which every "Get a quote" on the site links
 * to; the masthead's button jumps there too.
 */

const BILL_ICONS: Record<
  (typeof pricing.bill.items)[number]['icon'],
  ComponentType<{ weight?: 'bold' | 'duotone'; className?: string }>
> = {
  setup: Wrench,
  subscription: ArrowsClockwise,
  thirdParty: Handshake,
}

export function PricingPage({ lang }: { lang: Lang }) {
  const P = pricing
  const other: Lang = lang === 'ar' ? 'en' : 'ar'

  return (
    <>
      <Header
        lang={lang}
        alternate={pricingPath(other)}
        mark={<Wordmark tone="onDark" height={24} />}
      />
      <main id="top" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <Breadcrumbs lang={lang} trail={[{ name: P.crumb[lang], path: pricingPath(lang) }]} />

        {/* Masthead: the claim and both actions on the start side, the three
            facts a buyer asks first on the end side. Dark, like every page's
            first screen, so the header sits on its own colour. */}
        <section className="bg-void pt-32 pb-16 text-on-void lg:pt-36 lg:pb-20">
          <div className="shell grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-end lg:gap-16">
            <div className="lg:col-span-7">
              <h1 className="max-w-[20ch] text-balance font-display text-display font-extrabold">
                {P.title[lang]}
              </h1>
              <p className="mt-6 max-w-[58ch] text-lede text-on-void-dim">{P.lede[lang]}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href="#quote">
                    {P.quote[lang]}
                    <ArrowRight weight="bold" className="size-4 rtl:-scale-x-100" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="onDark">
                  <a href={DEMO_URL}>{P.tryDemo[lang]}</a>
                </Button>
              </div>
            </div>
            <ul className="divide-y divide-void-line border-y border-void-line lg:col-span-5">
              {P.facts.map((fact) => (
                <li key={fact.en} className="flex items-center gap-3 py-3.5 text-body text-on-void">
                  <CheckCircle weight="fill" className="size-5 shrink-0 text-positive" />
                  {fact[lang]}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Steps: a numbered strip, so "what happens after I send this" is
            answered before anyone is asked to send anything. */}
        <Section>
          <div className="shell">
            <SectionHeader title={P.steps.title[lang]} lede={P.steps.lede[lang]} />
            <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {P.steps.items.map((step, index) => (
                <li key={step.title.en} className="bg-paper-lift p-6">
                  <Reveal delay={index * STAGGER}>
                    <span
                      aria-hidden="true"
                      className="figures flex size-8 items-center justify-center rounded-full bg-blue font-mono text-label font-semibold text-on-brand"
                    >
                      {index + 1}
                    </span>
                    <h3 className="mt-4 font-display text-h3 font-bold text-heading">
                      {step.title[lang]}
                    </h3>
                    <p className="mt-2 text-body text-ink-dim">{step.body[lang]}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </Section>

        {/* The bill: three cards, the same three parts every quote has. */}
        <Section rule tone="lift">
          <div className="shell">
            <SectionHeader title={P.bill.title[lang]} lede={P.bill.lede[lang]} />
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {P.bill.items.map((item, index) => {
                const Icon = BILL_ICONS[item.icon]
                return (
                  <Reveal
                    key={item.title.en}
                    delay={index * STAGGER}
                    className="rounded-xl border border-line bg-paper p-6 shadow-sm"
                  >
                    <Icon weight="duotone" className="size-8 text-blue-ink" />
                    <h3 className="mt-4 font-display text-h3 font-bold text-heading">
                      {item.title[lang]}
                    </h3>
                    <p className="mt-2 text-body text-ink-dim">{item.body[lang]}</p>
                  </Reveal>
                )
              })}
            </div>
            <p className="mt-6 text-small text-ink-dim">{P.bill.footnote[lang]}</p>
          </div>
        </Section>

        {/* What moves the price: a table, because these are pairs to scan. */}
        <Section rule>
          <div className="shell">
            <SectionHeader title={P.drivers.title[lang]} lede={P.drivers.lede[lang]} />
            <div className="mt-10 overflow-hidden rounded-xl border border-line">
              <Table>
                <TableHeader>
                  <TableRow>
                    {P.drivers.head.map((cell) => (
                      <TableHead key={cell.en}>{cell[lang]}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {P.drivers.rows.map(([question, why]) => (
                    <TableRow key={question.en}>
                      <TableCell className="w-1/3 align-top font-semibold text-ink">
                        {question[lang]}
                      </TableCell>
                      <TableCell className="whitespace-normal text-ink-dim">{why[lang]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </Section>

        {/* Scope: a dark band of two lists, what every subscription has and
            what is added when wanted. No package names: the packages are
            internal, and this is enough to see the shape of the choice. */}
        <section className="bg-void py-16 text-on-void md:py-20 lg:py-24">
          <div className="shell">
            <SectionHeader dark title={P.scope.title[lang]} lede={P.scope.lede[lang]} />
            <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-16">
              {[
                { list: P.scope.included, Icon: CheckCircle, tone: 'text-positive' },
                { list: P.scope.added, Icon: PlusCircle, tone: 'text-blue-lit' },
              ].map(({ list, Icon, tone }) => (
                <div key={list.title.en}>
                  <h3 className="font-display text-h3 font-bold text-on-void">
                    {list.title[lang]}
                  </h3>
                  <ul className="mt-5 divide-y divide-void-line border-y border-void-line">
                    {list.items.map((item) => (
                      <li key={item.en} className="flex items-start gap-3 py-3.5 text-body">
                        <Icon weight="fill" className={`mt-0.5 size-5 shrink-0 ${tone}`} />
                        <span className="text-on-void">{item[lang]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The form, on the quietest surface on the page. */}
        <Section id="quote" tone="sunk">
          <div className="shell grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            <Reveal className="lg:col-span-5">
              <h2 className="max-w-[18ch] text-balance font-display text-h2 font-extrabold text-heading">
                {P.form.title[lang]}
              </h2>
              <p className="mt-5 max-w-[46ch] text-body text-ink-dim">{P.form.lede[lang]}</p>
              <p className="mt-4 max-w-[46ch] text-small text-ink-dim">{P.form.after[lang]}</p>
              <a
                href={DEMO_URL}
                className="mt-8 inline-flex items-center gap-2 text-small font-medium text-blue-ink hover:underline"
              >
                {P.form.selfServe[lang]}
                <ArrowRight weight="bold" className="size-3.5 rtl:-scale-x-100" />
              </a>
            </Reveal>
            <div className="lg:col-span-7">
              <LeadForm lang={lang} />
            </div>
          </div>
        </Section>

        {/* The questions, as `<details>` so the answers are in the HTML and
            readable without script, and the same strings `FaqSchema` marks up. */}
        <Section rule tone="lift">
          <div className="shell grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <h2 className="text-balance font-display text-h2 font-extrabold text-heading">
                {P.faqTitle[lang]}
              </h2>
              <p className="mt-4 max-w-[40ch] text-body text-ink-dim">
                {lang === 'ar'
                  ? 'ما لم تجدوا جوابه هنا، اسألونا مباشرة على '
                  : 'Anything not answered here, ask us directly at '}
                <EmailLink className="text-blue-ink hover:underline" />.
              </p>
            </div>
            <div className="divide-y divide-line border-y border-line lg:col-span-7">
              {P.faq.map((entry) => (
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
            items={P.faq.map((entry) => ({ question: entry.q[lang], answer: entry.a[lang] }))}
          />
        </Section>
      </main>
      <Footer
        lang={lang}
        alternate={pricingPath(other)}
        mark={<Wordmark tone="onDark" height={26} />}
      />
    </>
  )
}
