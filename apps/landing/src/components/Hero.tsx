'use client'

import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { Accrue } from '@/components/Accrue'
import { DEMO_URL, hero, type Lang } from '@/content/copy'

/**
 * A photograph, a sentence, and the product straddling the join.
 *
 * What was here: a centred headline in `font-extrabold tracking-[-0.04em]`, a
 * blue radial glow behind it, a glass pill above it with a pulsing green dot,
 * two fully-rounded buttons and a screenshot in a browser frame with a second
 * glow behind that. Every element of that list is a real technique. All of them
 * together are the default output of the tools that generate landing pages, and
 * a reader who has seen forty of them recognises it in about a second — which
 * is a disaster for a page whose whole argument is that this was built by
 * people who have actually seen a demurrage invoice.
 *
 * The four sites this was rebuilt against — CargoWise, tentrucks, Terminal and
 * Stripe — do not have a glow between them. What three of the four *do* have is
 * a full-bleed photograph of the industry, at full saturation, carrying all the
 * colour on the page. That is the swap: the light comes from a photograph of a
 * port at dusk instead of from a `radial-gradient`, and it is the same light,
 * except that it is of something.
 *
 * The rest follows from it. Weight 500 rather than 800 and tracking at
 * `-0.02em` rather than `-0.04em`, because at this size 800 is shouting and
 * every generated page shouts. A mono eyebrow, which is this repository's own
 * label convention. Buttons at `rounded-lg`, because a pill is the framework's
 * default and therefore everyone's. And no badge.
 *
 * **The frame straddles the boundary.** It is pulled up out of the paper into
 * the bottom of the photograph, so the two bands are joined by the product
 * rather than butted against each other. That one move is what stops this being
 * a photo section followed by a screenshot section.
 */
export function Hero({ lang, shot }: { lang: Lang; shot: string }) {
  const reduced = useReducedMotion()

  const enter = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] as const },
        }

  return (
    <section className="relative">
      {/* `data-tone="dark"` is read by `Header`, which inverts against whatever
          band is behind it. It is on the photograph band and not on the section,
          because the section also contains the product frame hanging down into
          the paper — and a header over that frame is over paper. */}
      <div
        data-tone="dark"
        className="relative isolate overflow-hidden bg-void pt-[9.5rem] pb-[13rem] lg:pt-[11rem] lg:pb-[15rem]"
      >
        <img
          src="/pic/photos/hero-port-dusk.webp"
          alt=""
          width={2000}
          height={1333}
          fetchPriority="high"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        {/* Two scrims, not one. A single flat wash heavy enough to carry white
            type kills the photograph; a vertical gradient plus a lighter overall
            wash keeps the sky and still seats the band into the paper below. */}
        <div className="absolute inset-0 -z-10 bg-void/72" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-void/85 via-transparent to-void" />

        <div className="shell relative flex flex-col items-center text-center">
          <motion.p {...enter(0.02)} className="tracked text-[0.62rem] text-on-void-faint">
            {hero.eyebrow[lang]}
          </motion.p>

          <motion.h1
            {...enter(0.08)}
            className="mt-7 max-w-[20ch] text-balance font-display text-[clamp(2.5rem,5.6vw,4.25rem)] font-medium leading-[1.06] tracking-[-0.02em] text-on-void"
          >
            {hero.title[lang].join(' ')}
          </motion.h1>

          <motion.p
            {...enter(0.18)}
            className="mt-7 max-w-[54ch] text-balance text-[clamp(1.05rem,1.5vw,1.25rem)] leading-[1.6] text-on-void-dim"
          >
            {hero.body[lang]}
          </motion.p>

          <motion.div {...enter(0.26)} className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href={DEMO_URL}
              className="tracked group flex items-center gap-2.5 rounded-lg bg-blue px-6 py-4 text-[0.66rem] leading-none text-on-brand transition-opacity hover:opacity-90"
            >
              {hero.primary[lang]}
              {/* `rtl:-scale-x-100` rather than a second icon: an arrow means
                  "onward", and onward is leftward in Arabic. */}
              <ArrowRight
                weight="bold"
                className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
              />
            </a>
            <a
              href="#work"
              className="tracked rounded-lg border border-on-void-faint/40 px-6 py-4 text-[0.66rem] leading-none text-on-void transition-colors hover:bg-void-lift"
            >
              {hero.secondary[lang]}
            </a>
          </motion.div>
        </div>
      </div>

      {/* Pulled up into the photograph. The negative margin is the whole idea —
          see the header — so it is deliberately larger than it looks like it
          needs to be. */}
      <div className="shell-wide relative z-10 -mt-[9rem] lg:-mt-[11rem]">
        <motion.div
          initial={reduced ? undefined : { opacity: 0, y: 26 }}
          animate={reduced ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.34, ease: [0.16, 1, 0.3, 1] }}
        >
          {/*
            Rounded at the top, square at the bottom, and one element rather
            than two.

            The rule across the site is that a frame with all four corners
            rounded is a complete object and a frame rounded only at the top is
            one that continues past its crop. This is the only cropped frame
            here, so it is the only one shaped this way — the ones in `Work` and
            `Bilingual` show a whole capture and keep all four.

            It was a rounded box inside a rounded box: the border and shadow on
            the outer element, the mask on the inner. That drew a crisp closed
            rectangle *underneath* an image that was dissolving — the frame
            finished itself while its contents evaporated, which is two edges
            making opposite claims about the same boundary. A radius says the
            object ends here and a fade says it does not.

            So the mask is on the element that carries the border, and it takes
            the border with it. The shadow went with the second element and is
            not missed: its top half sat on a dark photograph where a shadow is
            invisible, and its bottom half sat under the part that fades out.
          */}
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

        {/*
          The live figure, as one mono line under the frame.

          This is the counter that used to be a floating glass chip laid over
          the screenshot. The chip was the problem: an overlay that is not part
          of the interface underneath it is a sticker, and it covered a real
          card on the dashboard that says the same thing. As a caption it is the
          device Stripe opens with — one oddly specific, obviously live number
          in small type, which does more for credibility than any adjective. It
          is also, precisely, the argument of the entire page.
        */}
        <p className="mt-6 flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1 text-center font-mono text-[0.8rem] text-ink-faint">
          <span>{hero.tickerLabel[lang]}</span>
          <span className="figures font-medium text-amber">
            KWD <Accrue from={4187.264} perDay={32} />
          </span>
          <span className="text-ink-faint/70">{hero.tickerRef[lang]}</span>
        </p>
      </div>
    </section>
  )
}
