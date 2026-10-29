import type React from 'react'
import { Accrue, DaysSince } from '@/components/Accrue'
import { Reveal } from '@/components/Reveal'
import { STAGGER } from '@/lib/motion'
import { SectionHeader } from '@/components/ui/section'
import { DEMURRAGE_PER_DAY, FREE_TIME_ENDED, type Lang, leak, yard } from '@/content/copy'

/**
 * Demurrage, shown as the thing the software actually produces, on the ground
 * where it actually happens.
 *
 * The charge line is the point. What the product does with a running clock is
 * write one, so the section shows one: the container, the milestone that
 * started it, the rate, the days, and a total still moving. Every label on it
 * is a label the product prints — a forwarder who reads `Free time ended ·
 * discharge` knows in a second whether this was built by somebody who has seen
 * a demurrage invoice.
 *
 * **The card is white paper on a dark photograph, and that is the whole idea.**
 * It was a dark glass panel with a blur behind it, which made the one object on
 * the page that is meant to be a *document* look like a HUD. A delivery order
 * is white, a customs form is white, and a charge line lying on a photograph of
 * the yard it was raised against is an object a forwarder recognises. Square
 * corners and hairline rules for the same reason: the paperwork this trade runs
 * on is square, and a rounded card with a drop shadow reads as a component from
 * a design system.
 *
 * **Argument beside the document, not above it.** Stacked and centred, the
 * section ran to 1,100px for one headline, two paragraphs and one card; side by
 * side it is about half that, and the reader's eye goes from the claim straight
 * to the line that proves it.
 *
 * There is no illustration under it any more, and there is not meant to be. A
 * drawn berth plan sat there for a while — six numbered bays, one box called out
 * in amber, a dashed lane with marching ants along it. Both halves were wrong.
 * A `stroke-dashoffset` loop is the visual language of a loading spinner, so
 * the one moving thing in the section read as something still fetching; and the
 * drawing was a picture of a container yard laid on top of a photograph of a
 * container yard, which is the photograph's job and it does it better.
 */
export function Leak({ lang }: { lang: Lang }) {
  const line = leak.line

  return (
    <section className="relative isolate overflow-hidden py-16 md:py-20 lg:py-24">
      <img
        src="/pic/photos/containers-stack.webp"
        alt=""
        width={1600}
        height={1067}
        loading="lazy"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      {/* Two scrims. One flat wash heavy enough to carry the type kills the
          photograph; a gradient plus a lighter overall wash keeps the boxes
          legible and still seats the band into the paper above and below. */}
      <div className="absolute inset-0 -z-10 bg-void/80" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-void via-transparent to-void" />

      <div className="shell grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-6">
          <SectionHeader layout="stack" dark title={leak.title[lang]} lede={leak.body[lang]} />
          <p className="mt-5 max-w-[56ch] text-lede text-on-void">{leak.answer[lang]}</p>
          {/* The caption that admits what the photograph is. Without it the
              image is a stock backdrop; with it, it is the yard the counter
              refers to. */}
          <p className="mt-8 text-small text-on-void-faint">{yard.quote[lang]}</p>
        </Reveal>

        <Reveal className="lg:col-span-6" delay={STAGGER}>
          {/* A document is a fixed width and does not stretch to its
              container; letting it run the full measure would be the detail
              that gives away a web page pretending. */}
          <div className="mx-auto max-w-[34rem] bg-paper-lift shadow-2xl lg:me-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line-strong px-6 py-4 sm:px-8">
              <p className="figures font-mono text-body text-ink">{line.container}</p>
              <p className="text-small text-ink-faint">{line.lane[lang]}</p>
            </div>

            <dl className="divide-y divide-line px-6 sm:px-8">
              <Row label={line.startedLabel[lang]} value={line.startedValue[lang]} />
              <Row label={line.rateLabel[lang]} value={line.rateValue[lang]} />
              <Row
                label={line.daysLabel[lang]}
                value={
                  <>
                    <DaysSince since={FREE_TIME_ENDED} /> {line.daysTail[lang]}
                  </>
                }
              />
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-t border-line-strong py-6">
                <dt className="text-small font-medium text-ink-dim">{line.totalLabel[lang]}</dt>
                <dd className="figures flex items-baseline gap-2 font-mono text-ink">
                  <span className="text-small text-ink-faint">KWD</span>
                  <span className="text-[2.25rem] font-medium leading-none tracking-[-0.02em]">
                    <Accrue since={FREE_TIME_ENDED} perDay={DEMURRAGE_PER_DAY} />
                  </span>
                </dd>
              </div>
            </dl>

            <p className="border-t border-line px-6 py-4 text-small text-ink-dim sm:px-8">
              {line.written[lang]}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3.5">
      <dt className="text-small text-ink-faint">{label}</dt>
      <dd className="figures font-mono text-small text-ink-dim">{value}</dd>
    </div>
  )
}
