'use client'

import type { ReactNode } from 'react'
import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { ArrowRight, Clock } from '@phosphor-icons/react/dist/ssr'
import { Accrue } from '@/components/Accrue'
import { DEMO_URL, hero, type Lang } from '@/content/copy'

/**
 * The entrance. Three decisions, all of them reactions to what was here before.
 *
 * **The headline is short and there is nothing above it.** There used to be a
 * mono eyebrow reading "KUWAIT · SEA, AIR, ROAD, RAIL, COURIER" with a pulsing
 * dot beside it, and a forty-word paragraph under the headline listing seven
 * stages of a shipment. Both are the house style of every generated landing
 * page in the category, and neither told a forwarder anything the section
 * below does not. Nine words of headline, one sentence, and the facts from the
 * eyebrow moved to the quiet line under the buttons.
 *
 * **The product is the picture.** No stock photograph of a port. Forwarders
 * have seen a port. What they have not seen is this software, and the only
 * question the page has to answer in the first screen is whether it looks like
 * something an operations desk could work in for eight hours.
 *
 * **The screenshot stays on screen.** It ran off the right edge for a while,
 * on the theory that a frame running off the page reads as a window onto
 * something larger. It did not; it read as a frame that had escaped. Contained
 * in its column and centred against the copy, it is a screen being shown to
 * you rather than one sliding out of the room.
 */
export function Hero({ lang, shot }: { lang: Lang; shot: string }) {
  const section = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: section,
    offset: ['start start', 'end start'],
  })
  // Small. Parallax that a reader can consciously notice has overshot — this is
  // depth cueing, not an effect.
  const lift = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -70])
  const fade = useTransform(scrollYProgress, [0, 0.85], [1, reduced ? 1 : 0.35])

  const enter = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 22 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
        }

  return (
    <section ref={section} className="relative overflow-hidden pt-[9rem] pb-24 lg:pt-[10.5rem] lg:pb-32">
      <div className="grid-field pointer-events-none absolute inset-0" />

      <div className="shell relative z-10 grid items-center gap-y-16 lg:grid-cols-12 lg:gap-x-8">
        <div className="lg:col-span-5">

          <h1 className="font-display text-[clamp(2.5rem,5.4vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.035em]">
            {hero.title[lang].map((line, index) => (
              <motion.span
                key={line}
                {...enter(0.06 + index * 0.08)}
                className={`block ${index === 2 ? 'text-blue-lit' : ''}`}
              >
                {line}
              </motion.span>
            ))}
          </h1>

          <motion.p {...enter(0.34)} className="mt-7 max-w-[34rem] text-[1.0625rem] leading-[1.65] text-ink-dim">
            {hero.body[lang]}
          </motion.p>

          <motion.div {...enter(0.42)} className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href={DEMO_URL}
              className="group flex items-center gap-2 rounded-full bg-blue px-6 py-3.5 text-[0.95rem] font-semibold text-on-brand transition-transform hover:scale-[1.03] active:scale-100"
            >
              {hero.primary[lang]}
              {/* `rtl:-scale-x-100` rather than a second icon: an arrow means
                  "onward", and onward is leftward in Arabic. */}
              <ArrowRight
                weight="bold"
                className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
              />
            </a>
            <a
              href="#work"
              className="rounded-full border border-edge-lit px-6 py-3.5 text-[0.95rem] font-medium text-ink transition-colors hover:bg-raise"
            >
              {hero.secondary[lang]}
            </a>
          </motion.div>

          <motion.p {...enter(0.5)} className="mt-5 text-sm text-ink-faint">
            {hero.micro[lang]}
          </motion.p>
        </div>

        {/* The frame sits in the flow of its own column and is centred against
            the copy by the grid's `items-center`. It used to be absolutely
            placed and 58rem wide, which ran it off the right of the viewport —
            the bleed read as the frame having escaped rather than as a crop. */}
        <div className="relative lg:col-span-7">
          <motion.div
            style={{ y: lift, opacity: fade }}
            initial={reduced ? undefined : { opacity: 0, scale: 0.96 }}
            animate={reduced ? undefined : { opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full"
          >
            <div className="bloom pointer-events-none absolute inset-x-[8%] inset-y-[12%] -z-10" />

            <div className="tilt relative rounded-xl border border-edge-lit bg-raise shadow-2xl">
              <img
                src={`/pic/screens/${shot}.webp`}
                alt=""
                width={2360}
                height={1476}
                className="w-full rounded-xl"
                fetchPriority="high"
              />
            </div>

            <Chip lang={lang} />
          </motion.div>
        </div>
      </div>

    </section>
  )
}

/**
 * The one piece of interface laid over the screenshot, and it is real.
 *
 * It shows the same clock the product runs, at the same rate, to the same three
 * decimals. A visitor who watches it for three seconds has been told what the
 * software is for without reading a word of the copy.
 */
function Chip({ lang }: { lang: Lang }): ReactNode {
  return (
    <div className="absolute bottom-[8%] start-[4%] z-10 rounded-lg border border-edge-lit bg-void/90 p-4 shadow-2xl backdrop-blur-md">
      <p className="tracked flex items-center gap-1.5 text-[0.6rem] text-amber">
        <Clock weight="fill" className="size-3.5" />
        {hero.chipLabel[lang]}
      </p>
      <p className="figures mt-2 flex items-baseline gap-1.5 font-mono text-2xl font-medium text-ink">
        <span className="text-sm text-ink-faint">KWD</span>
        <Accrue from={128.462} perDay={32} />
      </p>
      <p className="mt-1 font-mono text-[0.7rem] text-ink-faint">{hero.chipRef[lang]}</p>
    </div>
  )
}
