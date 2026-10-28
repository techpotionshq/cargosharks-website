'use client'

import { motion } from 'motion/react'
import { DURATION, EASE } from '@/lib/motion'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { Accrue, DaysSince } from '@/components/Accrue'
import { Button } from '@/components/ui/button'
import { DEMO_URL, DEMURRAGE_PER_DAY, FREE_TIME_ENDED, hero, type Lang } from '@/content/copy'

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
 * every generated page shouts. Buttons at `rounded-lg`, because a pill is the
 * framework's default and therefore everyone's. No badge, and no eyebrow: the
 * mono label that sat above the headline said less than the headline did.
 *
 * **The headline is on the page before any script runs.** It used to fade in
 * from `opacity: 0`, which the server rendered inline, so the page's H1 was
 * invisible to a crawler and to anyone whose JavaScript was slow; it was also
 * the likely LCP element, held back 80ms on purpose. Only the product frame
 * moves now, and it rises from where it already is rather than appearing.
 *
 * **The frame straddles the boundary.** It is pulled up out of the paper into
 * the bottom of the photograph, so the two bands are joined by the product
 * rather than butted against each other. That one move is what stops this being
 * a photo section followed by a screenshot section.
 */
export function Hero({ lang, shot }: { lang: Lang; shot: string }) {
  return (
    <section className="relative">
      <div className="relative isolate overflow-hidden bg-void pt-36 pb-48 lg:pt-40 lg:pb-56">
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
          <h1 className="max-w-[18ch] text-balance font-display text-display font-extrabold text-on-void">
            {hero.title[lang]}
          </h1>

          <p className="mt-6 max-w-[58ch] text-balance text-lede text-on-void-dim">
            {hero.body[lang]}
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href={DEMO_URL}>
                {hero.primary[lang]}
                {/* `rtl:-scale-x-100` rather than a second icon: an arrow means
                    "onward", and onward is leftward in Arabic. */}
                <ArrowRight weight="bold" className="size-4 rtl:-scale-x-100" />
              </a>
            </Button>
            <Button asChild size="lg" variant="onDark">
              <a href="#demo">{hero.secondary[lang]}</a>
            </Button>
          </div>

          {/* What a Gulf buyer checks for first, as text. ZATCA leads because it
              is the question every forwarder in the region is asking now. */}
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-small text-on-void-dim">
            {hero.facts.map((fact, index) => (
              <li key={fact.en} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${index < 2 ? 'bg-positive' : 'bg-on-void-faint'}`}
                />
                {fact[lang]}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Pulled up into the photograph. The negative margin is the whole idea —
          see the header — so it is deliberately larger than it looks like it
          needs to be. */}
      <div className="shell-wide relative z-10 -mt-36 lg:-mt-44">
        {/* The same element whatever the motion preference: the server cannot
            know it, so a conditional here rendered one thing on the server and
            another in the browser. Reduced motion is pinned by CSS instead. */}
        <motion.div
          className="motion-reduce:transform-none!"
          initial={{ y: 24 }}
          animate={{ y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE }}
        >
          {/* Rounded at the top and square at the bottom: the only cropped frame
              on the page, so the only one shaped as continuing past its crop. The
              mask is on the element that carries the border so the two edges
              agree about where the object ends. */}
          <div className="floor max-h-[30rem] overflow-hidden rounded-t-2xl border border-b-0 border-line bg-paper-lift">
            <img
              src={`/pic/screens/${shot}.webp`}
              alt={
                lang === 'ar'
                  ? 'لوحة CargoSharks: الردود المتأخرة وغرامات التأخير الجارية والاستفسارات المفتوحة والشحنات الحالية'
                  : 'The CargoSharks dashboard: overdue replies, demurrage accruing, open enquiries and live shipments'
              }
              width={2360}
              height={1476}
              className="w-full"
            />
          </div>
        </motion.div>

        {/* One live figure under the frame. The days and the amount both come
            from `FREE_TIME_ENDED`, so they agree with each other and with today. */}
        <p className="mt-5 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-center text-small text-ink-faint">
          <span>{hero.tickerLabel[lang]}</span>
          <span className="figures font-mono font-medium text-amber">
            KWD <Accrue since={FREE_TIME_ENDED} perDay={DEMURRAGE_PER_DAY} />
          </span>
          <span className="figures">
            · MSKU 704 118 2 · <DaysSince since={FREE_TIME_ENDED} /> {hero.tickerDays[lang]}
          </span>
        </p>
      </div>
    </section>
  )
}
