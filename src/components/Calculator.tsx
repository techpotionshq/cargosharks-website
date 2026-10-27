'use client'

import { useState } from 'react'
import { Reveal } from '@/components/Reveal'
import { calculator, type Lang } from '@/content/copy'

/**
 * The one thing on this page the reader operates.
 *
 * Everything else here is the site talking. This is the reader putting four of
 * their own numbers in and getting an answer they did the arithmetic for — and
 * a figure somebody arrived at themselves is believed in a way that no
 * sentence on a marketing page is ever believed. Terminal's site opens its
 * middle third with exactly this and it is the best thing on it.
 *
 * **Money is a `number` here, and that is allowed precisely once.**
 * `CLAUDE.md` is categorical: money is `numeric(19,6)` in the database,
 * `Decimal` in the engines and a string on the wire, never a JS float. That
 * rule protects money that is *recorded*. Nothing here is recorded, sent or
 * priced — the whole computation lives inside this component, dies when the tab
 * closes, and is an estimate the reader is invited to disagree with. Pulling
 * `Decimal` into the marketing bundle to hold four slider positions would be
 * cargo-culting the rule rather than keeping it.
 *
 * The result still prints to three places, because it is denominated in dinars
 * and a Kuwaiti forwarder reading a figure rounded to two knows immediately
 * that whoever built it was thinking in dollars. That is the half of the rule
 * that does apply, and it is the half a reader can see.
 */
export function Calculator({ lang }: { lang: Lang }) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(calculator.fields.map((field) => [field.key, field.value])),
  )

  const boxes = values.boxes ?? 0
  const overrun = values.overrun ?? 0
  const days = values.days ?? 0
  const rate = values.rate ?? 0

  const affected = (boxes * 12 * overrun) / 100
  const perYear = affected * days * rate

  // `en-KW` rather than the reader's locale: the figure is Kuwaiti dinars and
  // it should group and point the way a Kuwaiti invoice does, whichever browser
  // is open. Three decimals, for the reason in the header.
  const money = (n: number) =>
    n.toLocaleString('en-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

  const headline = money(perYear)

  /**
   * The result shrinks when it gets long, because the sliders can make it very
   * long indeed.
   *
   * At the defaults it is nine characters. Pushed to their maxima the four
   * inputs multiply out to `115,200,000.000` — fifteen — and at a fixed 3rem
   * that ran off a panel five columns wide, which is a broken layout the reader
   * causes themselves and therefore the worst kind. Two steps rather than a
   * continuous fit: the figure has to stay a headline, and a clamp fine-grained
   * enough never to overflow leaves it the size of the body text.
   */
  const size =
    headline.length > 13
      ? 'text-[clamp(1.5rem,3.2vw,2rem)]'
      : headline.length > 10
        ? 'text-[clamp(1.8rem,3.8vw,2.5rem)]'
        : 'text-[clamp(2.1rem,4.4vw,3rem)]'

  return (
    // `#calculator` is linked from blog posts (scripts/blog/product-facts.md),
    // so it is part of the site's address space: renaming it breaks them.
    <section
      id="calculator"
      className="scroll-mt-28 border-t border-line bg-paper-sunk py-band-sm lg:py-band"
    >
      <Reveal className="shell flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-ink-faint">{calculator.eyebrow[lang]}</p>
        <h2 className="mt-5 max-w-[20ch] text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.02em]">
          {calculator.title[lang]}
        </h2>
        <p className="mt-5 max-w-[52ch] text-balance text-[1.0625rem] leading-[1.65] text-ink-dim">
          {calculator.sub[lang]}
        </p>
      </Reveal>

      <div className="shell mt-12 grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7">
          <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {calculator.fields.map((field) => {
              const value = values[field.key] ?? field.value

              return (
                <div key={field.key}>
                  <label
                    htmlFor={`calc-${field.key}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-[0.9rem] text-ink-dim">{field.label[lang]}</span>
                    <span className="figures font-mono text-[1.05rem] text-ink">
                      {value}
                      {'unit' in field && field.unit ? (
                        <span className="ms-1 text-[0.75rem] text-ink-faint">
                          {field.unit[lang]}
                        </span>
                      ) : null}
                    </span>
                  </label>

                  {/* A range rather than a text field. A number input invites a
                      reader to stop and think about what to type; a slider
                      invites them to move it, and a reader who has moved it has
                      watched the answer respond, which is the entire point. */}
                  <input
                    id={`calc-${field.key}`}
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={value}
                    onChange={(event) =>
                      setValues((was) => ({ ...was, [field.key]: Number(event.target.value) }))
                    }
                    className="slider mt-3 h-1 w-full cursor-pointer appearance-none rounded-full bg-line-strong"
                  />
                </div>
              )
            })}
          </div>

          <p className="mt-9 border-t border-line pt-7 text-[0.9375rem] leading-[1.7] text-ink-dim">
            {calculator.note[lang]}
          </p>
        </div>

        {/*
          The answer, on the one dark panel in this half of the page.

          It is dark because it is the only thing here that is not an input, and
          because a figure this size on the same paper as the sliders reads as
          another form field.
        */}
        <div className="rounded-2xl bg-void p-8 lg:col-span-5 lg:p-10">
          <p className="tracked text-[0.6rem] text-on-void-faint">{calculator.resultLabel[lang]}</p>

          <p className="figures mt-5 flex flex-wrap items-baseline gap-x-2.5 font-mono leading-none text-on-void">
            <span className="tracked text-[0.7rem] text-on-void-faint">
              {calculator.currency[lang]}
            </span>
            <span className={`font-medium tracking-[-0.02em] text-amber ${size}`}>{headline}</span>
          </p>

          <dl className="mt-8 divide-y divide-void-line border-t border-void-line">
            <div className="flex items-baseline justify-between gap-4 py-4">
              <dt className="text-[0.85rem] text-on-void-faint">{calculator.monthLabel[lang]}</dt>
              <dd className="figures font-mono text-[0.95rem] text-on-void-dim">
                {calculator.currency[lang]} {money(perYear / 12)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-4">
              <dt className="text-[0.85rem] text-on-void-faint">{calculator.boxesLabel[lang]}</dt>
              <dd className="figures font-mono text-[0.95rem] text-on-void-dim">
                {Math.round(affected)}{' '}
                <span className="text-on-void-faint">{calculator.boxesUnit[lang]}</span>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}
