import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { Section } from '@/components/ui/section'
import { DEMO_URL, enquiry, type Lang } from '@/content/copy'
import { LeadForm } from './LeadForm'

/**
 * The close: book a demo, and say what happens after it.
 *
 * It replaces two sections that said the same thing twice: a dark "judge it
 * in ten minutes" band with two buttons, and under it a form asking for a
 * trial. There is no trial. The demo is open to anyone, the meetings before a
 * decision are free, and setup, onboarding and the subscription are quoted
 * per operation, so the three steps say exactly that and the form asks what
 * the quote depends on.
 *
 * On paper, because a form wants the quietest surface on the page. The id is
 * `demo` because every "Book a demo" link on the site already points at
 * `/#demo`.
 */
export function Enquiry({ lang }: { lang: Lang }) {
  return (
    <Section id="demo" rule tone="sunk">
      <div className="shell grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-5">
          <h2 className="max-w-[18ch] text-balance font-display text-h2 font-extrabold text-heading">
            {enquiry.title[lang]}
          </h2>
          <p className="mt-5 max-w-[46ch] text-body text-ink-dim">{enquiry.body[lang]}</p>

          <ol className="mt-8 border-s border-line-strong">
            {enquiry.steps.map((step, index) => (
              <li key={step.title.en} className="relative ps-6 pb-6 last:pb-0">
                <span
                  aria-hidden="true"
                  className="figures absolute -start-3 top-0 flex size-6 items-center justify-center rounded-full border border-line-strong bg-paper-lift font-mono text-label text-ink"
                >
                  {index + 1}
                </span>
                <p className="text-body font-semibold text-ink">{step.title[lang]}</p>
                <p className="mt-1 text-small text-ink-dim">{step.body[lang]}</p>
              </li>
            ))}
          </ol>

          <a
            href={DEMO_URL}
            className="mt-8 inline-flex items-center gap-2 text-small font-medium text-blue-ink hover:underline"
          >
            {enquiry.selfServe[lang]}
            <ArrowRight weight="bold" className="size-3.5 rtl:-scale-x-100" />
          </a>
        </Reveal>

        <div className="lg:col-span-7">
          <LeadForm lang={lang} />
        </div>
      </div>
    </Section>
  )
}
