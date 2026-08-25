'use client'

import type { ReactNode } from 'react'
import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { ArrowRight, Clock } from '@phosphor-icons/react/dist/ssr'
import { Accrue } from '@/components/Accrue'
import { Frame } from '@/components/Frame'
import { DEMO_URL, hero, type Lang } from '@/content/copy'

/**
 * The entrance. Centred, and that is the change that mattered.
 *
 * It was a five-column copy block beside a seven-column screenshot, which is
 * the split every B2B page in the category uses and which failed here in a
 * specific way: at 1440 the copy column is about 460px, so a nine-word headline
 * broke across three lines and the sentence under it across two, while the
 * screenshot — the only thing on the page that answers the question a forwarder
 * actually has — was rendered at 700px and its sidebar labels came out at nine
 * pixels. The page was giving half its width to text that needed a third of it,
 * and starving the picture.
 *
 * Centred, the headline gets the full measure and sets in two lines, and the
 * frame below it gets the whole 84rem. Nothing was cut to do it. The reason
 * every product site converges on this composition is that it is the one that
 * lets the product be the largest thing on the page, which is the only argument
 * a landing page has that a competitor cannot copy in an afternoon.
 *
 * The parallax is gone with it. Lifting the frame as the reader scrolls was
 * fighting the `.floor` mask for the same edge, and a mask that moves relative
 * to what it is masking shows its seam.
 */
export function Hero({ lang, shot }: { lang: Lang; shot: string }) {
  const section = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: section,
    offset: ['start start', 'end start'],
  })
  // The light behind the page fades as the hero leaves, so the section under it
  // does not inherit a glow that belongs to a headline no longer on screen.
  const glow = useTransform(scrollYProgress, [0, 0.9], [1, reduced ? 1 : 0])

  const enter = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
        }

  return (
    <section ref={section} className="relative overflow-hidden pt-[8.5rem] pb-0 lg:pt-[10rem]">
      <motion.div style={{ opacity: glow }} className="pointer-events-none absolute inset-x-0 top-0 h-[46rem]">
        <div className="aurora absolute inset-0" />
      </motion.div>
      <div className="grid-field pointer-events-none absolute inset-x-0 top-0 h-[42rem]" />

      <div className="shell relative z-10 flex flex-col items-center text-center">
        <motion.a
          {...enter(0.02)}
          href={DEMO_URL}
          className="group flex items-center gap-2.5 rounded-full border border-edge-lit bg-raise/60 py-1.5 pe-2 ps-3.5 text-[0.8rem] text-ink-dim backdrop-blur-sm transition-colors hover:border-ink-faint hover:text-ink"
        >
          <span className="live-dot relative size-1.5 rounded-full bg-positive text-positive" />
          {hero.badge[lang]}
          <span className="rounded-full bg-void/70 px-2 py-0.5 text-[0.7rem] text-ink-faint">
            {hero.badgeNote[lang]}
          </span>
          <ArrowRight
            weight="bold"
            className="size-3 text-ink-faint transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
          />
        </motion.a>

        {/* `text-balance` rather than the hand-split lines this used to carry.
            The copy file still splits the headline into three, and at the full
            centred measure those breaks are wrong — "one file." alone on a line
            is a fragment when the line above it has room for it. Balancing lets
            the browser choose, which is right when the measure is this wide and
            the same string has to work in a script whose words are longer. */}
        <h1 className="mt-8 max-w-[19ch] text-balance font-display text-[clamp(2.6rem,6.4vw,4.6rem)] font-extrabold leading-[1.02] tracking-[-0.04em]">
          {hero.title[lang].map((line, index) => (
            <motion.span key={line} {...enter(0.06 + index * 0.07)} className={index === 2 ? 'text-blue-lit' : ''}>
              {line}{' '}
            </motion.span>
          ))}
        </h1>

        <motion.p {...enter(0.32)} className="mt-7 max-w-[46ch] text-balance text-[1.09rem] leading-[1.65] text-ink-dim">
          {hero.body[lang]}
        </motion.p>

        <motion.div {...enter(0.4)} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href={DEMO_URL}
            className="group flex items-center gap-2 rounded-full bg-blue px-6 py-3.5 text-[0.95rem] font-semibold text-on-brand shadow-lg transition-transform hover:scale-[1.03] active:scale-100"
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
            className="rounded-full border border-edge-lit bg-raise/40 px-6 py-3.5 text-[0.95rem] font-medium text-ink backdrop-blur-sm transition-colors hover:bg-raise"
          >
            {hero.secondary[lang]}
          </a>
        </motion.div>

        <motion.p {...enter(0.48)} className="mt-6 text-[0.85rem] text-ink-faint">
          {hero.micro[lang]}
        </motion.p>
      </div>

      {/* The frame is the widest thing on the page and it is not in `.shell`.
          It gets its own concentric measure — see `.shell-wide` — because a
          1440-wide capture inside a 1200-wide text column is unreadable, which
          defeats the only reason it is here. */}
      <div className="shell-wide relative z-10 mt-16 lg:mt-20">
        <motion.div
          initial={reduced ? undefined : { opacity: 0, y: 28, scale: 0.985 }}
          animate={reduced ? undefined : { opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1.1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <div className="bloom pointer-events-none absolute inset-x-[12%] inset-y-[18%] -z-10" />

          {/* Cropped to its top, not shown whole.
              At this measure the capture is 770px tall, which put its bottom
              edge below the fold on every laptop and made the first screen of
              the page a headline and a *slice* of a screenshot with no visible
              end to it. Cropped to 32rem the frame finishes on screen, and what
              is cut is the bottom of a dashboard — the least informative part
              of it. The mask then fades the last of that away, so the image
              visibly continues past what is shown rather than stopping at a
              rule, which is the cheapest possible "keep scrolling". */}
          <div className="floor relative max-h-[32rem] overflow-hidden">
            <Frame url={hero.frameUrl} lang={lang}>
              <img
                src={`/pic/screens/${shot}.webp`}
                alt=""
                width={2360}
                height={1476}
                className="w-full"
                fetchPriority="high"
              />
            </Frame>
          </div>

          <Chip lang={lang} />
        </motion.div>
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
 *
 * It sits *outside* `.floor` — the mask fades the bottom of the frame away, and
 * a chip inside it would fade with the thing it is annotating.
 *
 * **Placed at 45% rather than in a corner.** A callout belongs in a bottom
 * corner and this one cannot be there: the frame is cropped and its last third
 * is being faded out, so a chip at `bottom-8` sat in the middle of the gradient
 * with a half-dissolved sidebar showing through it — neither on the screenshot
 * nor on the page. Just under half way down it is on solid image, and it lands
 * alongside the dashboard's own "Demurrage accruing" card, so the live figure
 * reads as an enlargement of something really on the screen behind it rather
 * than as a sticker.
 */
function Chip({ lang }: { lang: Lang }): ReactNode {
  return (
    <div className="absolute top-[45%] start-[3%] z-10 hidden rounded-xl border border-edge-lit bg-void/85 p-4 shadow-2xl backdrop-blur-xl sm:block">
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
