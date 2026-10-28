import { Plus } from '@phosphor-icons/react/dist/ssr'
import { EmailLink } from '@/components/Email'
import { Reveal } from '@/components/Reveal'
import { Band, SectionHead } from '@/components/Section'
import { FaqSchema } from '@/components/StructuredData'
import type { Lang } from '@/content/copy'
import { faq } from '@/content/home'

/**
 * The questions a buyer asks on the first call, answered before it.
 *
 * Two of them are about what the product does not do yet (e-invoicing, an
 * accounting connector), and they are answered plainly. A buyer who finds that
 * out in week two of a pilot is lost; one who reads it here and still asks for
 * a pilot is the right one.
 *
 * `<details>` rather than a client component: it opens without JavaScript, the
 * browser's find-in-page searches inside closed answers, and the answers are in
 * the HTML for the FAQ schema to describe truthfully.
 */
export function Faq({ lang }: { lang: Lang }) {
  return (
    <Band id="faq">
      <div className="shell grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHead align="start" eyebrow={faq.eyebrow[lang]} title={faq.title[lang]} />
          <Reveal>
            <p className="mt-6 text-[1rem] leading-[1.6] text-ink-dim">{faq.more[lang]}</p>
            <EmailLink className="mt-2 inline-block font-mono text-[0.95rem] text-blue-ink hover:underline" />
          </Reveal>
        </div>

        <Reveal className="lg:col-span-7">
          <div className="divide-y divide-line border-y border-line">
            {faq.items.map((item) => (
              <details key={item.q.en} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[1.08rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {item.q[lang]}
                  <Plus
                    weight="bold"
                    aria-hidden="true"
                    className="size-5 shrink-0 text-ink-faint transition-transform group-open:rotate-45"
                  />
                </summary>
                <p className="max-w-[62ch] pb-6 text-[1rem] leading-[1.7] text-ink-dim">
                  {item.a[lang]}
                </p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>

      <FaqSchema
        items={faq.items.map((item) => ({ question: item.q[lang], answer: item.a[lang] }))}
      />
    </Band>
  )
}
