import { ArrowDown } from '@phosphor-icons/react/dist/ssr'
import { Accrue } from '@/components/Accrue'
import { Reveal } from '@/components/Reveal'
import { calculator, type Lang, leak, yard } from '@/content/copy'

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
 * It sits beside its argument now rather than under it: the heading, the
 * paragraph and the card were three centred blocks stacked down a dark band,
 * and on a laptop the card, which is the point, started below the fold.
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

      <div className="shell grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-5">
          <p className="text-[0.9rem] font-semibold text-amber">{leak.eyebrow[lang]}</p>

          <h2 className="mt-3 text-balance font-display text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.1] tracking-[-0.025em] text-on-void">
            {leak.title[lang]}
          </h2>

          <p className="mt-6 text-[1.05rem] leading-[1.7] text-on-void-dim">{leak.body[lang]}</p>

          <p className="mt-5 text-[1.05rem] leading-[1.7] text-on-void">{leak.answer[lang]}</p>

          <a
            href="#calculator"
            className="group mt-8 inline-flex items-center gap-2 text-[0.98rem] font-semibold text-amber"
          >
            {calculator.title[lang]}
            <ArrowDown
              weight="bold"
              className="size-4 transition-transform group-hover:translate-y-0.5"
            />
          </a>
        </Reveal>

        <Reveal className="lg:col-span-7" delay={0.08}>
          {/* A document is a fixed width and does not stretch to its
              container, so the card keeps its own measure inside the column. */}
          <div className="mx-auto max-w-[40rem] bg-paper-lift shadow-2xl">
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
                <dt className="text-[0.85rem] font-medium text-ink-faint">
                  {line.totalLabel[lang]}
                </dt>
                <dd className="figures flex items-baseline gap-2 font-mono text-ink">
                  <span className="text-[0.75rem] text-ink-faint">KWD</span>
                  <span className="text-[clamp(1.9rem,4vw,2.8rem)] font-medium leading-none tracking-[-0.02em] text-amber-ink">
                    <Accrue from={4187.264} perDay={32} />
                  </span>
                </dd>
              </div>

              <p className="mt-5 flex items-center gap-2 border-t border-line pt-5 text-[0.85rem] text-ink-dim">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-positive" />
                {line.written[lang]}
              </p>
            </div>
          </div>

          <p className="mt-6 text-center text-[0.85rem] text-on-void-faint">{yard.quote[lang]}</p>
        </Reveal>
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
