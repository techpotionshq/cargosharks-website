import { CheckCircle, Clock } from '@phosphor-icons/react/dist/ssr'
import { Accrue } from '@/components/Accrue'
import { type Lang, leak } from '@/content/copy'

/**
 * Demurrage, shown as the thing the software actually produces.
 *
 * This was a seven-inch number floating on navy with two paragraphs beside it —
 * the "one enormous statistic" section every page in the category has, which
 * proves nothing and could be on any of them. What CargoSharks actually does
 * with a running clock is *write a charge line*, so the section shows a charge
 * line: the container, the milestone that started it, the rate, the days, and a
 * total still moving. Same figure, doing a job.
 *
 * Every label on the card is one the product prints. That is the point of
 * showing it rather than describing it — a forwarder reads `Free time ended ·
 * discharge` and knows immediately whether this was built by someone who has
 * seen a demurrage invoice.
 */
export function Leak({ lang }: { lang: Lang }) {
  const line = leak.line

  return (
    <section className="border-t border-edge bg-deep py-band-sm lg:py-band">
      <div className="shell grid items-center gap-14 lg:grid-cols-12 lg:gap-x-16">
        <div className="lg:col-span-5">
          <p className="tracked flex items-center gap-2 text-[0.68rem] text-amber">
            <Clock weight="fill" className="size-4" />
            {leak.eyebrow[lang]}
          </p>

          <h2 className="mt-6 font-display text-[clamp(1.75rem,3.4vw,2.6rem)] font-extrabold leading-[1.12] tracking-[-0.03em]">
            {leak.title[lang]}
          </h2>

          <p className="mt-6 text-[1.0625rem] leading-[1.7] text-ink-dim">{leak.body[lang]}</p>

          <p className="mt-6 border-s-2 border-blue ps-5 text-[1.0625rem] leading-[1.7] text-ink">
            {leak.answer[lang]}
          </p>
        </div>

        <div className="lg:col-span-7">
          {/*
            Square corners, hairline rules, mono figures. The paperwork this
            trade runs on is square — a manifest, a delivery order, a customs
            form — and a charge line rendered as a rounded card with a drop
            shadow would read as a component from a design system rather than as
            a document the software issued.
          */}
          <div className="rounded-sm border border-edge-lit bg-raise">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-edge px-6 py-5 sm:px-8">
              <p className="figures font-mono text-[1.05rem] text-ink">{line.container}</p>
              <p className="text-[0.85rem] text-ink-faint">{line.lane[lang]}</p>
            </div>

            <dl className="divide-y divide-edge px-6 sm:px-8">
              <Row label={line.startedLabel[lang]} value={line.startedValue[lang]} />
              <Row label={line.rateLabel[lang]} value={line.rateValue[lang]} />
              <Row label={line.daysLabel[lang]} value={line.daysValue[lang]} />
            </dl>

            <div className="border-t border-edge-lit px-6 py-6 sm:px-8">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <dt className="tracked text-[0.62rem] text-ink-faint">{line.totalLabel[lang]}</dt>
                <dd className="figures flex items-baseline gap-2 font-mono text-ink">
                  <span className="tracked text-[0.7rem] text-ink-faint">KWD</span>
                  <span className="text-[clamp(1.8rem,3.6vw,2.6rem)] font-medium leading-none tracking-[-0.03em]">
                    <Accrue from={4187.264} perDay={32} />
                  </span>
                </dd>
              </div>

              {/* The one green thing on the page, and it is earning it: this is
                  the claim the whole section makes, stated as a status. */}
              <p className="mt-4 flex items-center gap-2 text-[0.8rem] text-positive">
                <CheckCircle weight="fill" className="size-4 shrink-0" />
                {line.written[lang]}
              </p>
            </div>
          </div>
        </div>
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
