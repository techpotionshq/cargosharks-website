import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { STAGGER } from '@/lib/motion'
import { Section, SectionHeader } from '@/components/ui/section'
import { InvoiceExample } from '@/components/visuals'
import { einvoicing, type Lang } from '@/content/copy'
import { solutionPath } from '@/content/solution-nav'

/**
 * ZATCA and UAE e-invoicing, second on the page.
 *
 * It is the first question a Gulf forwarder asks a vendor now, so it is
 * answered right after the hero rather than in a FAQ. The evidence is an
 * invoice rather than an illustration: four lines from a Saudi branch, each
 * with the VAT treatment the product decides for it, set as a real table with
 * numbers aligned on the decimal (tabular figures, end-aligned), so a finance
 * reader can add it up. They can: 6,400 + 850 + 600 + 3,200 = 11,050, and VAT
 * is 15% of the one standard-rated line, 600, which is 90.
 *
 * The amounts are SAR, two decimals, because that is the riyal. The site
 * never rounds a dinar to two; it never pads a riyal to three either.
 */
export function EInvoicing({ lang }: { lang: Lang }) {
  return (
    <Section id="e-invoicing" rule>
      <div className="shell">
        <SectionHeader title={einvoicing.title[lang]} lede={einvoicing.lede[lang]} />

        {/* `grid-cols-1` rather than an implicit column: an implicit track is as
            wide as its widest content, which is the table, and that pushed the
            page 30px sideways on a phone. `minmax(0, 1fr)` lets the table
            container scroll instead. */}
        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          <Reveal className="lg:col-span-5">
            <dl className="divide-y divide-line border-y border-line">
              {einvoicing.points.map((point) => (
                <div key={point.label.en} className="py-5">
                  <dt className="text-body font-semibold text-ink">{point.label[lang]}</dt>
                  <dd className="mt-1.5 text-small text-ink-dim">{point.body[lang]}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 flex flex-col gap-2.5">
              <a
                href={solutionPath('uae-e-invoicing-freight-forwarders', lang)}
                className="group inline-flex items-center gap-2 text-small font-medium text-blue-ink hover:underline"
              >
                {einvoicing.links.uae[lang]}
                <ArrowRight className="size-3.5 rtl:-scale-x-100" weight="bold" />
              </a>
              <a
                href={solutionPath('freight-forwarding-software-saudi-arabia', lang)}
                className="group inline-flex items-center gap-2 text-small font-medium text-blue-ink hover:underline"
              >
                {einvoicing.links.saudi[lang]}
                <ArrowRight className="size-3.5 rtl:-scale-x-100" weight="bold" />
              </a>
            </div>
          </Reveal>

          <Reveal className="lg:col-span-7" delay={STAGGER}>
            <InvoiceExample lang={lang} />
          </Reveal>
        </div>
      </div>
    </Section>
  )
}
