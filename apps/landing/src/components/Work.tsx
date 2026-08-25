'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChatCircleText, Path, Receipt } from '@phosphor-icons/react/dist/ssr'
import { Frame } from '@/components/Frame'
import { type Lang, steps, work } from '@/content/copy'

/**
 * One icon per desk, and that is the whole of the icon budget for this section.
 *
 * The three stages are otherwise distinguished only by a number, and a number
 * says which one comes next rather than what it is. An envelope, a route and a
 * receipt say commercial, operations and finance without a label — which is
 * useful, unlike the row of decorative glyphs that would result from also
 * giving one to each of the nine bullets underneath.
 */
const STEP_ICONS = {
  commercial: ChatCircleText,
  operations: Path,
  finance: Receipt,
} as const

/** How long a stage holds before the section moves itself on. */
const DWELL_MS = 7000

/**
 * Three desks, as three tabs over one centred frame.
 *
 * This was a scroll-pinned sequence: three copy blocks in a five-column rail on
 * the left, a `position: sticky` screenshot on the right, and the current stage
 * read off scroll position every frame. It was the most ambitious thing on the
 * page and it had two faults, one of them fatal.
 *
 * **The frame did not fit.** It was `w-[54rem] max-w-none` in a seven-column
 * track about 44rem wide, deliberately, so it would bleed toward the edge. At
 * 1440 that put roughly 150px of the product past the right of the viewport —
 * so the finance capture, whose figures are at its trailing edge, was showing a
 * column of numbers cut in half. The one section built entirely to show the
 * product was the section that showed the least of it.
 *
 * **And scroll is a bad control for this.** A reader who wants the finance
 * screen has to scroll through commercial and operations to reach it, and a
 * finance buyer is exactly who this section is for. Two of the three stages
 * were also dimmed to 35% at any moment, which means two thirds of the copy on
 * a 1300px-tall section was deliberately hard to read.
 *
 * Tabs fix both. The frame gets the full centred measure, every stage is one
 * click away, nothing is dimmed, and the section is about half the height. It
 * still advances on its own so a passive reader sees all three — see `useEffect`
 * for the three conditions that stop it.
 */
export function Work({ lang, shotSuffix }: { lang: Lang; shotSuffix: string }) {
  const [active, setActive] = useState(0)
  const [held, setHold] = useState(false)
  const section = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    /**
     * Three things stop the carousel, and each one is a reader telling us
     * something.
     *
     * `held` — they clicked a tab. Once somebody has chosen a stage, moving
     * them off it is the software arguing with them, so this one never lifts.
     *
     * Off screen — advancing a section nobody is looking at means they arrive
     * at stage two with no idea there was a stage one. An observer rather than
     * scroll maths because the only question here is in view or not, which is
     * exactly what an observer answers well.
     *
     * Reduced motion — an automatic cross-fade is motion the reader did not
     * ask for. The tabs still work; the page just stops moving on its own.
     */
    if (held || reduced) return

    const node = section.current
    if (!node) return

    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer === null) timer = setInterval(() => setActive((n) => (n + 1) % steps.length), DWELL_MS)
    }
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }

    const observer = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()), {
      threshold: 0.35,
    })
    observer.observe(node)

    return () => {
      observer.disconnect()
      stop()
    }
  }, [held, reduced])

  // `noUncheckedIndexedAccess` is on across the workspace, and it is right to
  // be: nothing but this line guarantees `active` indexes a stage that exists.
  const current = steps[active] ?? steps[0]
  if (!current) return null

  return (
    <section ref={section} id="work" className="relative scroll-mt-24 py-band-sm lg:py-band">
      <div className="shell flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-ink-faint">{work.eyebrow[lang]}</p>
        <h2 className="mt-5 max-w-[20ch] text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-extrabold leading-[1.08] tracking-[-0.035em]">
          {work.title[lang]}
        </h2>
        <p className="mt-6 max-w-[52ch] text-balance text-[1.0625rem] leading-[1.7] text-ink-dim">
          {work.sub[lang]}
        </p>

        {/* The tab rail. A `role="tablist"` with real arrow-key handling would
            be the textbook markup, but these are buttons that swap a picture
            and a paragraph — not panels of focusable content — and buttons are
            what a keyboard user can already operate. */}
        <div className="mt-11 flex w-full max-w-[42rem] flex-col gap-2 sm:flex-row sm:gap-3">
          {steps.map((step, index) => {
            const Icon = STEP_ICONS[step.icon as keyof typeof STEP_ICONS]
            const on = index === active

            return (
              <button
                key={step.n}
                type="button"
                onClick={() => {
                  setActive(index)
                  setHold(true)
                }}
                aria-pressed={on}
                className={`group relative flex-1 overflow-hidden rounded-xl border px-4 py-3.5 text-start transition-colors ${
                  on
                    ? 'border-edge-lit bg-raise text-ink'
                    : 'border-edge bg-raise/30 text-ink-faint hover:border-edge-lit hover:text-ink-dim'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon weight="regular" className={`size-4 shrink-0 ${on ? 'text-blue-lit' : ''}`} />
                  <span className="tracked text-[0.58rem]">{step.n}</span>
                  <span className="text-[0.9rem] font-medium">{step.desk[lang]}</span>
                </span>

                {/* The dwell, drawn. Without it an automatic advance looks like
                    the page twitching; with it, the reader can see it coming and
                    knows the tab they are about to lose is one click back.
                    Keyed on `active` so it restarts with each stage. */}
                {on && !held && !reduced ? (
                  <motion.span
                    key={active}
                    aria-hidden="true"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: DWELL_MS / 1000, ease: 'linear' }}
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-blue-lit rtl:origin-right"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {/* Full centred measure, so the capture is legible. This is the fault the
          rewrite exists to fix — see the header. */}
      <div className="shell-wide relative mt-10 lg:mt-12">
        <div className="bloom pointer-events-none absolute inset-x-[14%] inset-y-[16%] -z-10" />

        <Frame lang={lang} label={current.desk[lang]}>
          {/* The container holds the aspect ratio so a cross-fade does not
              collapse the section's height to zero between two absolutely
              positioned images. */}
          <div className="relative aspect-[2360/1476]">
            <AnimatePresence initial={false}>
              <motion.img
                key={current.shot}
                src={`/pic/screens/${current.shot}${shotSuffix}.webp`}
                alt=""
                width={2360}
                height={1476}
                loading="lazy"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 h-full w-full"
              />
            </AnimatePresence>
          </div>
        </Frame>
      </div>

      <div className="shell mt-12 lg:mt-14">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.n}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex flex-col items-center text-center">
              <h3 className="max-w-[24ch] text-balance font-display text-[clamp(1.4rem,2.6vw,2rem)] font-bold leading-[1.18] tracking-[-0.025em]">
                {current.title[lang]}
              </h3>
              <p className="mt-5 max-w-[58ch] text-balance text-[1.0625rem] leading-[1.7] text-ink-dim">
                {current.body[lang]}
              </p>
            </div>

            <ul className="mt-11 grid gap-px overflow-hidden rounded-xl border border-edge bg-edge sm:grid-cols-3">
              {current.points.map((point) => (
                <li
                  key={point.en}
                  className="bg-raise/40 px-6 py-7 text-[0.9375rem] leading-[1.6] text-ink-dim"
                >
                  <span aria-hidden="true" className="mb-4 block h-px w-6 bg-blue-lit" />
                  {point[lang]}
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
