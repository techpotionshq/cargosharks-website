'use client'

import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Check } from '@phosphor-icons/react/dist/ssr'
import { Accrue } from '@/components/Accrue'
import { arrow, button } from '@/components/Section'
import { DEMO_URL, hero, type Lang } from '@/content/copy'
import { heroCopy } from '@/content/home'

/**
 * A photograph, a promise, and the product straddling the join.
 *
 * The photograph and the straddling frame stay from the last version; they were
 * the parts that worked. What changed is everything a reader actually reads.
 * The headline said what the software is shaped like ("From enquiry to
 * invoice, one file"), which is true of every system in the category; it now
 * says the one thing that is true of this one. The buttons were ten-pixel
 * tracked capitals; they are sentence case at reading size, and the pilot, the
 * offer that reaches a person, is the primary one. Three short facts sit under
 * them so a reader who never scrolls still knows it is bilingual, covers their
 * mode and can be tried without a form.
 *
 * **The frame straddles the boundary.** It is pulled up out of the paper into
 * the bottom of the photograph, so the two bands are joined by the product
 * rather than butted against each other.
 */
export function Hero({ lang, shot }: { lang: Lang; shot: string }) {
  const reduced = useReducedMotion()

  // The same element and starting state whatever the setting, for the
  // hydration reason in `Reveal.tsx`; reduced motion only takes the time out.
  const enter = (delay: number) => ({
    'data-reveal': '',
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: reduced
      ? { duration: 0 }
      : { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] as const },
  })

  const [before, lit, after] = heroCopy.title[lang]

  return (
    <section className="relative">
      <div className="relative isolate overflow-hidden bg-void pt-[8.5rem] pb-[12rem] lg:pt-[10rem] lg:pb-[14rem]">
        <img
          src="/pic/photos/hero-port-dusk.webp"
          alt=""
          width={2000}
          height={1333}
          fetchPriority="high"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        {/* Two scrims: a lighter overall wash that keeps the sky, and a
            gradient that seats the band into the paper below. */}
        <div className="absolute inset-0 -z-10 bg-void/70" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-void/85 via-transparent to-void" />

        <div className="shell relative flex flex-col items-center text-center">
          <motion.p
            {...enter(0.02)}
            className="inline-flex items-center gap-2 rounded-full border border-void-line bg-on-void/5 px-4 py-1.5 text-[0.85rem] text-on-void-dim"
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-blue-lit" />
            {heroCopy.badge[lang]}
          </motion.p>

          <motion.h1
            {...enter(0.08)}
            className="mt-7 max-w-[19ch] text-balance font-display text-[clamp(2.6rem,6vw,4.6rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-on-void"
          >
            {before}
            <span className="text-blue-lit">{lit}</span>
            {after}
          </motion.h1>

          <motion.p
            {...enter(0.18)}
            className="mt-7 max-w-[58ch] text-pretty text-[clamp(1.05rem,1.5vw,1.22rem)] leading-[1.6] text-on-void-dim"
          >
            {heroCopy.body[lang]}
          </motion.p>

          <motion.div
            {...enter(0.26)}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <a href="#pilot" className={button.primary}>
              {heroCopy.primary[lang]}
              <ArrowRight weight="bold" className={arrow} />
            </a>
            <a href={DEMO_URL} className={button.secondaryDark}>
              {heroCopy.secondary[lang]}
            </a>
          </motion.div>

          <motion.ul
            {...enter(0.32)}
            className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
          >
            {heroCopy.points.map((point) => (
              <li key={point.en} className="flex items-center gap-2 text-[0.9rem] text-on-void-dim">
                <Check weight="bold" className="size-4 text-blue-lit" aria-hidden="true" />
                {point[lang]}
              </li>
            ))}
          </motion.ul>
        </div>
      </div>

      <div className="shell-wide relative z-10 -mt-[8.5rem] lg:-mt-[10.5rem]">
        <motion.div
          data-reveal=""
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduced ? { duration: 0 } : { duration: 1, delay: 0.34, ease: [0.16, 1, 0.3, 1] }
          }
        >
          {/* Rounded at the top and faded at the bottom: the one cropped frame
              on the page, so the one shaped as continuing past its edge. The
              mask is on the element that carries the border, so the border
              fades with the picture rather than closing a box around it. */}
          <div className="floor max-h-[30rem] overflow-hidden rounded-t-2xl border border-b-0 border-line bg-paper-lift">
            <img
              src={`/pic/screens/${shot}.webp`}
              alt=""
              width={2360}
              height={1476}
              className="w-full"
              fetchPriority="high"
            />
          </div>
        </motion.div>

        {/* One live, oddly specific number in small type under the frame. It
            is the argument of the demurrage section below, arriving early. */}
        <p className="mt-6 flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1 text-center font-mono text-[0.8rem] text-ink-faint">
          <span>{hero.tickerLabel[lang]}</span>
          <span className="figures font-medium text-amber-ink">
            KWD <Accrue from={4187.264} perDay={32} />
          </span>
          <span className="text-ink-faint/70">{hero.tickerRef[lang]}</span>
        </p>
      </div>
    </section>
  )
}
