import { Reveal } from '@/components/Reveal'
import { SectionHead } from '@/components/Section'
import { type Lang, pilot } from '@/content/copy'
import { pilotSteps } from '@/content/home'
import { LeadForm } from './LeadForm'

/**
 * Where every "Ask for a pilot" on the page lands.
 *
 * On paper rather than in a dark band: a form wants the quietest surface on the
 * page. The left column says what happens after the button, in three numbered
 * steps, so the form is not the first thing a cautious reader commits to; a
 * list of three reassurances said the same things without saying in what order
 * they happen, which is the question somebody about to hand over their rate
 * cards is actually asking.
 */
export function Pilot({ lang }: { lang: Lang }) {
  return (
    <section id="pilot" className="scroll-mt-28 bg-paper py-band-sm lg:py-band">
      <div className="shell grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHead
            align="start"
            eyebrow={pilot.eyebrow[lang]}
            title={pilot.title[lang]}
            sub={pilot.body[lang]}
          />

          <Reveal>
            <h3 className="mt-10 text-[0.9rem] font-semibold text-ink-faint">
              {pilotSteps.title[lang]}
            </h3>
            <ol className="mt-5 space-y-6">
              {pilotSteps.steps.map((step, index) => (
                <li key={step.title.en} className="flex gap-4">
                  <span className="figures inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-wash font-mono text-[0.9rem] font-semibold text-blue-ink">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-[1.02rem] font-semibold text-ink">{step.title[lang]}</p>
                    <p className="mt-1 text-[0.95rem] leading-[1.6] text-ink-dim">
                      {step.body[lang]}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>

        <Reveal className="lg:col-span-7" delay={0.06}>
          <LeadForm lang={lang} />
        </Reveal>
      </div>
    </section>
  )
}
