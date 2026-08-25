import { CheckCircle, Clock } from '@phosphor-icons/react/dist/ssr'
import { Accrue } from '@/components/Accrue'
import { type Lang, leak, yard } from '@/content/copy'

/**
 * Demurrage, shown as the thing the software actually produces, on the ground
 * where it actually happens.
 *
 * Two rewrites, and the second is the one visible here. The first replaced a
 * seven-inch number floating on navy — the "one enormous statistic" section
 * every page in the category has, which proves nothing and could be on any of
 * them — with the charge line the product writes: the container, the milestone
 * that started it, the rate, the days, and a total still moving. Every label on
 * the card is one the product prints, which is the point of showing it rather
 * than describing it. A forwarder who reads `Free time ended · discharge` knows
 * immediately whether this was built by somebody who has seen a demurrage
 * invoice.
 *
 * The second rewrite put it in a container yard. `public/pic/photos` had four
 * photographs in it that no page referenced — bought, credited, re-encoded, and
 * never used — and this is the one section on the site whose subject is a
 * physical object standing in a physical place costing money by the hour.
 * Flat navy was the wrong surface for it. The photograph is not decoration
 * here: the reader is looking at the thing the counter is counting.
 *
 * The scrim is doing real work and is not negotiable — the card is hairline
 * borders and mono figures over a high-frequency photograph of stacked boxes,
 * and without it the type is unreadable. Two layers, because one flat black
 * wash at the opacity the text needs kills the photograph entirely: a strong
 * vertical gradient to seat the section into the bands above and below, and a
 * softer overall wash for the middle.
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
      <div className="absolute inset-0 -z-10 bg-void/80" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-void via-void/55 to-void" />

      <div className="shell flex flex-col items-center text-center">
        <p className="tracked flex items-center gap-2 text-[0.62rem] text-amber">
          <Clock weight="fill" className="size-4" />
          {leak.eyebrow[lang]}
        </p>

        <h2 className="mt-6 max-w-[20ch] text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-extrabold leading-[1.08] tracking-[-0.035em]">
          {leak.title[lang]}
        </h2>

        <p className="mt-6 max-w-[56ch] text-balance text-[1.0625rem] leading-[1.7] text-ink-dim">
          {leak.body[lang]}
        </p>

        <p className="mt-7 max-w-[52ch] text-balance text-[1.0625rem] leading-[1.7] text-ink">
          {leak.answer[lang]}
        </p>
      </div>

      {/*
        Square corners, hairline rules, mono figures. The paperwork this trade
        runs on is square — a manifest, a delivery order, a customs form — and a
        charge line rendered as a rounded card with a drop shadow would read as
        a component from a design system rather than as a document the software
        issued.

        It is narrower than the copy above it on purpose. A document is a fixed
        width and does not stretch to its container; letting this one run the
        full measure would be the one detail that gave away that it is a web
        page pretending.
      */}
      <div className="shell mt-14">
        <div className="mx-auto max-w-[46rem] rounded-sm border border-edge-lit bg-void/85 shadow-2xl backdrop-blur-md">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-edge px-6 py-5 sm:px-8">
            <p className="figures font-mono text-[1.05rem] text-ink">{line.container}</p>
            <p className="text-[0.85rem] text-ink-faint">{line.lane[lang]}</p>
          </div>

          <dl className="divide-y divide-edge px-6 sm:px-8">
            <Row label={line.startedLabel[lang]} value={line.startedValue[lang]} />
            <Row label={line.rateLabel[lang]} value={line.rateValue[lang]} />
            <Row label={line.daysLabel[lang]} value={line.daysValue[lang]} />
          </dl>

          <div className="border-t border-edge-lit px-6 py-7 sm:px-8">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <dt className="tracked text-[0.62rem] text-ink-faint">{line.totalLabel[lang]}</dt>
              <dd className="figures flex items-baseline gap-2 font-mono text-ink">
                <span className="tracked text-[0.7rem] text-ink-faint">KWD</span>
                <span className="text-[clamp(1.9rem,4vw,2.9rem)] font-medium leading-none tracking-[-0.03em]">
                  <Accrue from={4187.264} perDay={32} />
                </span>
              </dd>
            </div>

            {/* The one green thing on the page, and it is earning it: this is
                the claim the whole section makes, stated as a status. */}
            <p className="mt-5 flex items-center gap-2 text-[0.8rem] text-positive">
              <CheckCircle weight="fill" className="size-4 shrink-0" />
              {line.written[lang]}
            </p>
          </div>
        </div>

        {/* The caption that admits what the photograph is. Without it the image
            is a stock backdrop; with it, it is the yard the counter refers to. */}
        <p className="mt-8 text-center text-[0.85rem] text-ink-faint">{yard.quote[lang]}</p>
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
