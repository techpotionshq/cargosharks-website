import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { Section, SectionHeader } from '@/components/ui/section'
import { type Lang, markets } from '@/content/copy'
import { solutionNav, solutionPath } from '@/content/solution-nav'

/**
 * The market and job pages, linked from the home page's own HTML.
 *
 * These are the pages written to rank ("freight forwarding software Kuwait",
 * «برنامج تخليص جمركي»), and until this section the only links to them were
 * in header panels that render on hover, so a crawler starting at the home
 * page never found them. Three markets get a row each, with the phrase a
 * buyer searches as the link text; the jobs follow as plain links.
 */
export function Markets({ lang }: { lang: Lang }) {
  const marketRows = solutionNav.filter((item) => item.group === 'market')
  const jobs = solutionNav.filter((item) => item.group === 'job')

  return (
    <Section rule space="tight">
      <div className="shell">
        <SectionHeader title={markets.title[lang]} lede={markets.lede[lang]} />

        <ul className="mt-10 grid border-y border-line md:grid-cols-3 md:divide-x md:divide-line rtl:md:divide-x-reverse">
          {marketRows.map((item) => (
            <li key={item.slug} className="border-b border-line last:border-b-0 md:border-b-0">
              {/* Padded on both sides, first cell included: a hover fill that
                  runs to the text's edge on one side only looks clipped. */}
              <a
                href={solutionPath(item.slug, lang)}
                className="group flex h-full flex-col gap-2 px-4 py-6 transition-colors hover:bg-paper-sunk md:px-6"
              >
                <span className="flex items-center justify-between gap-3 text-h3 font-bold text-heading">
                  {item.label[lang]}
                  <ArrowRight
                    weight="bold"
                    className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-blue-ink rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
                  />
                </span>
                <span className="text-small text-ink-dim">{item.blurb[lang]}</span>
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-6">
          <p className="shrink-0 text-small font-medium text-ink">{markets.jobs[lang]}</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {jobs.map((item) => (
              <li key={item.slug}>
                <a
                  href={solutionPath(item.slug, lang)}
                  className="text-small text-ink-dim underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                >
                  {item.label[lang]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}
