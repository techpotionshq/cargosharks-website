import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { DEMO_URL, type Lang } from '@/content/copy'
import { pricingPath, quoteBand, quotePath } from '@/content/pricing'

/**
 * The close of the home page: ask for a quote, or open the demo.
 *
 * The full form used to sit here, under the heading "Book a demo", while the
 * header's "Live demo" opened the software, so one word meant two things and
 * the only route to a quote was the bottom of the home page. The form now
 * lives on `/pricing/`, beside how a quote is built, and this band points
 * there from the page most visitors arrive on.
 *
 * The id stays `demo`: posts in the CMS and links on other sites say
 * `/#demo`, and they should land on a way to ask for a quote rather than the
 * top of the page.
 */
export function QuoteBand({ lang }: { lang: Lang }) {
  return (
    <Section id="demo" rule tone="sunk">
      <Reveal className="shell flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
        <div>
          <h2 className="max-w-[24ch] text-balance font-display text-h2 font-extrabold text-heading">
            {quoteBand.title[lang]}
          </h2>
          <p className="mt-4 max-w-[60ch] text-body text-ink-dim">{quoteBand.body[lang]}</p>
          <a
            href={pricingPath(lang)}
            className="mt-4 inline-flex items-center gap-2 text-small font-medium text-blue-ink hover:underline"
          >
            {quoteBand.howPricing[lang]}
            <ArrowRight weight="bold" className="size-3.5 rtl:-scale-x-100" />
          </a>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Button asChild size="lg">
            <a href={quotePath(lang)}>
              {lang === 'ar' ? 'اطلبوا عرض سعر' : 'Get a quote'}
              <ArrowRight weight="bold" className="size-4 rtl:-scale-x-100" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={DEMO_URL}>{lang === 'ar' ? 'جرّبوا النسخة التجريبية' : 'Try the demo'}</a>
          </Button>
        </div>
      </Reveal>
    </Section>
  )
}
