import type { ComponentType } from 'react'
import { ArrowRight, CopySimple, Timer, Tray } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { Band, SectionHead } from '@/components/Section'
import type { Lang } from '@/content/copy'
import { pains } from '@/content/home'

const ICONS: Record<string, ComponentType<{ weight?: 'duotone'; className?: string }>> = {
  inbox: Tray,
  clock: Timer,
  copy: CopySimple,
}

/**
 * The problem, before the product.
 *
 * The page went straight from the hero into how the software is built, which
 * asks a reader to care about a solution before agreeing there is a problem.
 * Three cards name the three ways a desk run on email and spreadsheets loses
 * money, in the order a job meets them: the quote, the box, the invoice. The
 * line under them is the turn into the rest of the page.
 */
export function Pains({ lang }: { lang: Lang }) {
  return (
    <Band className="pt-20 lg:pt-28">
      <div className="shell">
        <SectionHead
          eyebrow={pains.eyebrow[lang]}
          title={pains.title[lang]}
          sub={pains.sub[lang]}
        />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {pains.cards.map((card, index) => {
            const Icon = ICONS[card.icon] ?? Tray
            return (
              <Reveal key={card.icon} delay={index * 0.06}>
                <article className="h-full rounded-2xl border border-line bg-paper-lift p-7 shadow-sm">
                  <span className="inline-flex size-11 items-center justify-center rounded-xl bg-amber-wash text-amber-ink">
                    <Icon weight="duotone" className="size-6" />
                  </span>
                  <h3 className="mt-6 font-display text-[1.25rem] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">
                    {card.title[lang]}
                  </h3>
                  <p className="mt-3 text-[0.98rem] leading-[1.65] text-ink-dim">
                    {card.body[lang]}
                  </p>
                </article>
              </Reveal>
            )
          })}
        </div>

        <Reveal className="mt-8">
          <p className="flex flex-col items-start gap-3 rounded-2xl bg-blue-wash px-7 py-5 text-[1.05rem] font-medium leading-[1.5] text-ink sm:flex-row sm:items-center">
            <ArrowRight weight="bold" className="size-5 shrink-0 text-blue-ink rtl:-scale-x-100" />
            {pains.answer[lang]}
          </p>
        </Reveal>
      </div>
    </Band>
  )
}
