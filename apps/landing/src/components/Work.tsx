'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Reveal } from '@/components/Reveal'
import { type Lang, steps, work } from '@/content/copy'

/** How long a stage holds before the section moves itself on. */
const DWELL_MS = 7000

/**
 * Three desks, as three tabs over one centred frame.
 *
 * The version before last pinned a screenshot and read the current stage off
 * scroll position. It had a fatal fault — the frame was `w-[54rem]` in a track
 * 44rem wide, so about 150px of the finance capture sat outside the viewport,
 * and the finance figures are at that edge — and a design fault: a finance
 * buyer had to scroll through commercial and operations to reach the only
 * screen they came for, while two thirds of the copy sat dimmed to 35%.
 *
 * Tabs fixed the fault. What is different here is only how they are drawn:
 * they were rounded boxes with a filled active state, which is a segmented
 * control, and a segmented control implies the three options are settings of
 * one thing. These are chapters. So they are a rule with an underline moving
 * along it — the tab shape every document with sections has used since before
 * software — and the stage number is set in the mono this repository labels
 * everything in.
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
     * at stage two with no idea there was a stage one.
     *
     * Reduced motion — an automatic cross-fade is motion the reader did not
     * ask for. The tabs still work; the page just stops moving on its own.
     */
    if (held || reduced) return

    const node = section.current
    if (!node) return

    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer === null)
        timer = setInterval(() => setActive((n) => (n + 1) % steps.length), DWELL_MS)
    }
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }

    const observer = new IntersectionObserver(
      ([entry]) => (entry?.isIntersecting ? start() : stop()),
      {
        threshold: 0.3,
      },
    )
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
    <section
      ref={section}
      id="work"
      className="scroll-mt-28 border-t border-line py-band-sm lg:py-band"
    >
      <Reveal className="shell flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-ink-faint">{work.eyebrow[lang]}</p>
        <h2 className="mt-5 max-w-[20ch] text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.02em]">
          {work.title[lang]}
        </h2>
        <p className="mt-5 max-w-[52ch] text-balance text-[1.0625rem] leading-[1.65] text-ink-dim">
          {work.sub[lang]}
        </p>
      </Reveal>

      {/* The tab rail. Buttons rather than a `role="tablist"` with arrow-key
          handling: these swap a picture and a paragraph, not panels of
          focusable content, and a keyboard user can already operate a button. */}
      <div className="shell mt-12">
        <div className="flex justify-center border-b border-line">
          {steps.map((step, index) => {
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
                className={`relative -mb-px flex items-baseline gap-2.5 px-4 py-4 transition-colors sm:px-7 ${
                  on ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
                }`}
              >
                <span className="tracked text-[0.58rem]">{step.n}</span>
                <span className="text-[0.95rem] font-medium">{step.desk[lang]}</span>

                {/* The underline is the tab. It is also the dwell: keyed on
                    `active` so it restarts with each stage, it grows across the
                    tab over the seven seconds the stage holds, so an automatic
                    advance is something the reader watched coming rather than
                    the page twitching. */}
                {on ? (
                  <motion.span
                    key={held || reduced ? 'held' : active}
                    aria-hidden="true"
                    initial={held || reduced ? { scaleX: 1 } : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: held || reduced ? 0 : DWELL_MS / 1000, ease: 'linear' }}
                    className="absolute inset-x-0 bottom-0 h-px origin-left bg-ink rtl:origin-right"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {/* Full centred measure, so the capture is legible — this is the fault the
          rewrite exists to fix. */}
      <Reveal className="shell-wide mt-10 lg:mt-12">
        <div className="overflow-hidden rounded-2xl border border-line shadow-xl">
          <div className="bg-paper-lift">
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
          </div>
        </div>
      </Reveal>

      <div className="shell mt-12">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.n}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex flex-col items-center text-center">
              <h3 className="max-w-[26ch] text-balance font-display text-[clamp(1.35rem,2.4vw,1.9rem)] font-medium leading-[1.22] tracking-[-0.015em]">
                {current.title[lang]}
              </h3>
              <p className="mt-5 max-w-[58ch] text-balance text-[1.0625rem] leading-[1.7] text-ink-dim">
                {current.body[lang]}
              </p>
            </div>

            {/* Hairlines, not cards — the same reasoning as the capability grid.
                A row of three boxes is a component; three columns divided by a
                rule is a page. */}
            <ul className="mt-12 grid gap-px border-y border-line bg-line sm:grid-cols-3">
              {current.points.map((point, index) => (
                <li key={point.en} className="bg-paper px-6 py-8">
                  <p className="tracked text-[0.55rem] text-ink-faint">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <p className="mt-4 text-[0.9375rem] leading-[1.65] text-ink-dim">{point[lang]}</p>
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
