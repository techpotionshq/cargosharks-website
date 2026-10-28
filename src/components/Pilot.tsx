import { Check } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { type Lang, pilot } from '@/content/copy'
import { LeadForm } from './LeadForm'

/**
 * Where "Ask for a pilot" lands, on the home page under the closing band.
 *
 * On paper rather than in the dark band above it: a form wants the quietest
 * surface on the page, and a light card on a photograph of the sea is a form
 * a reader has to squint at. The left column says what a pilot is in three
 * lines, so the form is not the first thing a cautious reader commits to.
 */
export function Pilot({ lang }: { lang: Lang }) {
  return (
    <section id="pilot" className="scroll-mt-28 bg-paper py-band-sm lg:py-band">
      <Reveal className="shell grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <p className="tracked text-[0.62rem] text-blue">{pilot.eyebrow[lang]}</p>
          <h2 className="mt-5 max-w-[16ch] text-balance font-display text-[clamp(2rem,4vw,2.9rem)] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
            {pilot.title[lang]}
          </h2>
          <p className="mt-6 max-w-[46ch] text-[1.02rem] leading-[1.7] text-ink-dim">
            {pilot.body[lang]}
          </p>
          <ul className="mt-8 space-y-3.5">
            {pilot.points.map((point) => (
              <li
                key={point.en}
                className="flex items-start gap-3 text-[0.95rem] leading-[1.55] text-ink"
              >
                <Check
                  weight="bold"
                  className="mt-1 size-4 shrink-0 text-blue"
                  aria-hidden="true"
                />
                {point[lang]}
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-7">
          <LeadForm lang={lang} />
        </div>
      </Reveal>
    </section>
  )
}
