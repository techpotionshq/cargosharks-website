import { Accrue } from '@/components/Accrue'
import { type Lang, leak, yard } from '@/content/copy'

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
    <section className="relative isolate overflow-hidden py-band-sm lg:py-band">
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
      <div className="absolute inset-0 -z-10 bg-void/78" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-void via-transparent to-void" />

      <div className="shell flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-amber">{leak.eyebrow[lang]}</p>

        <h2 className="mt-6 max-w-[20ch] text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.02em] text-on-void">
          {leak.title[lang]}
        </h2>

        <p className="mt-6 max-w-[56ch] text-balance text-[1.0625rem] leading-[1.7] text-on-void-dim">
          {leak.body[lang]}
        </p>

        <p className="mt-6 max-w-[52ch] text-balance text-[1.0625rem] leading-[1.7] text-on-void">
          {leak.answer[lang]}
        </p>
      </div>

      <div className="shell mt-14">
        {/* Narrower than the copy above it on purpose. A document is a fixed
            width and does not stretch to its container; letting this one run the
            full measure would be the detail that gives away that it is a web
            page pretending. */}
        <div className="mx-auto max-w-[44rem] bg-paper-lift shadow-2xl">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line-strong px-7 py-5 sm:px-9">
            <p className="figures font-mono text-[1.05rem] text-ink">{line.container}</p>
            <p className="text-[0.85rem] text-ink-faint">{line.lane[lang]}</p>
          </div>

          <dl className="divide-y divide-line px-7 sm:px-9">
            <Row label={line.startedLabel[lang]} value={line.startedValue[lang]} />
            <Row label={line.rateLabel[lang]} value={line.rateValue[lang]} />
            <Row label={line.daysLabel[lang]} value={line.daysValue[lang]} />
          </dl>

          <div className="border-t border-line-strong px-7 py-7 sm:px-9">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <dt className="tracked text-[0.6rem] text-ink-faint">{line.totalLabel[lang]}</dt>
              <dd className="figures flex items-baseline gap-2 font-mono text-ink">
                <span className="tracked text-[0.7rem] text-ink-faint">KWD</span>
                <span className="text-[clamp(1.9rem,4vw,2.8rem)] font-medium leading-none tracking-[-0.02em]">
                  <Accrue from={4187.264} perDay={32} />
                </span>
              </dd>
            </div>

            <p className="mt-5 border-t border-line pt-5 text-[0.8rem] text-ink-dim">
              {line.written[lang]}
            </p>
          </div>
        </div>

        {/* The caption that admits what the photograph is. Without it the image
            is a stock backdrop; with it, it is the yard the counter refers to.

            There was a drawn berth plan above this line — six numbered bays with
            one box called out in amber, and a dashed lane with marching ants
            running along it. It went for two reasons. The animation was the
            cheap kind: a `stroke-dashoffset` loop is the visual language of a
            loading state, so the one moving thing in the section read as
            something still fetching. And the drawing was illustrating a
            container yard directly on top of a photograph of a container yard.
            The photograph is better at it. */}
        <p className="mt-10 text-center text-[0.85rem] text-on-void-faint">{yard.quote[lang]}</p>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
      <dt className="text-[0.9rem] text-ink-faint">{label}</dt>
      <dd className="figures font-mono text-[0.9rem] text-ink-dim">{value}</dd>
    </div>
  )
}
