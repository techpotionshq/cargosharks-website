import type { ComponentType } from 'react'
import {
  CurrencyCircleDollar,
  FileText,
  Path,
  ShieldCheck,
  Table,
} from '@phosphor-icons/react/dist/ssr'
import { DinarArt, RouteArt } from '@/components/Illustrations'
import { capabilities, type Lang } from '@/content/copy'

/**
 * The section the page did not have.
 *
 * Between "three desks work one file" and "here is a demurrage clock" there was
 * nothing, which left the specific questions a buyer actually arrives with —
 * does it hold my rate cards, does it print my documents, can my Kuwait branch
 * see my Dubai branch's rows — answered only on `/what-we-do/`. That is a page
 * nobody opens until they have already decided the product is plausible, so the
 * answers were sitting behind the decision they were meant to inform.
 *
 * Five cards, and every one names a mechanism rather than a benefit. "Rate
 * cards that cannot collide" is a claim about a database constraint and can be
 * checked; "powerful rate management" is the same sentence with the checkable
 * part removed. The difference is the whole reason this section is worth its
 * height.
 *
 * The grid is deliberately uneven — one wide card, one tall, three ordinary.
 * Five equal cards is a spec sheet, and a spec sheet is read as a list of
 * things to skim rather than a set of arguments to weigh.
 */
const CARD_ICONS: Record<string, ComponentType<{ weight?: 'regular'; className?: string }>> = {
  route: Path,
  money: CurrencyCircleDollar,
  rates: Table,
  docs: FileText,
  tenancy: ShieldCheck,
}

/** `art` in the copy file is a key; the drawing itself lives in `Illustrations`. */
const CARD_ART = {
  route: RouteArt,
  dinar: DinarArt,
} as const

/**
 * Column spans, keyed off the copy rather than written into the markup.
 *
 * The grid is six columns so that a third is a whole number — `wide` takes four
 * and `tall` two on the first row, then three cards take two each on the second.
 * Below `lg` everything is one column and the spans do not apply, which is why
 * they are only ever set at the `lg` breakpoint.
 */
const SPANS = {
  wide: 'lg:col-span-4',
  tall: 'lg:col-span-2',
  third: 'lg:col-span-2',
} as const

export function Capabilities({ lang }: { lang: Lang }) {
  return (
    <section className="border-t border-edge bg-deep py-band-sm lg:py-band">
      <div className="shell flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-ink-faint">{capabilities.eyebrow[lang]}</p>
        <h2 className="mt-5 max-w-[22ch] text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-extrabold leading-[1.08] tracking-[-0.035em]">
          {capabilities.title[lang]}
        </h2>
        <p className="mt-6 max-w-[56ch] text-balance text-[1.0625rem] leading-[1.7] text-ink-dim">
          {capabilities.sub[lang]}
        </p>
      </div>

      <div className="shell-wide mt-14 grid gap-4 lg:grid-cols-6">
        {capabilities.cards.map((card) => {
          const Icon = CARD_ICONS[card.icon]
          const Art = card.art ? CARD_ART[card.art as keyof typeof CARD_ART] : null

          return (
            <article
              key={card.key}
              className={`lit group relative flex flex-col overflow-hidden rounded-2xl border border-edge bg-raise/50 p-7 transition-colors hover:border-edge-lit lg:p-8 ${
                SPANS[card.span as keyof typeof SPANS]
              }`}
            >
              <span className="flex size-10 items-center justify-center rounded-lg border border-edge-lit bg-void/50 text-blue-lit">
                {Icon ? <Icon weight="regular" className="size-5" /> : null}
              </span>

              <h3 className="mt-6 font-display text-[1.15rem] font-bold leading-[1.3] tracking-[-0.015em] text-ink">
                {card.title[lang]}
              </h3>
              <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-[1.65] text-ink-dim">
                {card.body[lang]}
              </p>

              {/* The drawing sits at the bottom of the card on whatever height
                  is left over, so a card with art and a card without still line
                  their text up. `mt-auto` rather than a fixed height: the Arabic
                  body runs longer and a fixed slot would clip it.

                  It is capped, and that is not a taste call. An inline `<svg>`
                  with a `viewBox` and no width scales to its container, so on
                  the wide card the lane ran to 750px and the dinar figure set
                  at roughly 50px — a drawing louder than the heading above it,
                  which inverts the card. Capped, both read as a diagram
                  supporting the text, which is the job. */}
              {Art ? (
                <div className="mt-auto pt-10">
                  <div className={card.art === 'route' ? 'max-w-[26rem]' : 'max-w-[13rem]'}>
                    <Art />
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
