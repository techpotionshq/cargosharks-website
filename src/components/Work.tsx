'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Reveal } from '@/components/Reveal'
import { SectionHeader } from '@/components/ui/section'
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
      className="scroll-mt-24 border-t border-line py-16 md:py-20 lg:py-24"
    >
      <Reveal className="shell">
        <SectionHeader title={work.title[lang]} lede={work.sub[lang]} />
      </Reveal>

      {/* The tab rail. Buttons rather than a `role="tablist"` with arrow-key
          handling: these swap a picture and a paragraph, not panels of
          focusable content, and a keyboard user can already operate a button. */}
      <div className="shell mt-10">
        <div className="flex overflow-x-auto border-b border-line">
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
                className={`relative -mb-px flex items-baseline gap-2 py-3.5 pe-6 transition-colors sm:pe-8 ${
                  on ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
                }`}
              >
                <span className="figures font-mono text-label">{step.n}</span>
                <span className="text-body font-medium">{step.desk[lang]}</span>

                {/* The underline is the tab. It is also the dwell: keyed on
                    `active` so it restarts with each stage, it grows across the
                    tab over the seven seconds the stage holds, so an automatic
                    advance is something the reader watched coming rather than
                    the page twitching. */}
                {on ? (
                  <motion.span
                    key={held || reduced ? 'held' : active}
                    aria-hidden="true"
                    // `reduced` is unknown on the server, so it no longer picks the
                    // starting state; with reduced motion the CSS shows the
                    // underline whole instead of growing it.
                    initial={held ? { scaleX: 1 } : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: held || reduced ? 0 : DWELL_MS / 1000, ease: 'linear' }}
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-ink motion-reduce:transform-none! rtl:origin-right"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {/* Full centred measure, so the capture is legible — this is the fault the
          rewrite exists to fix. */}
      <Reveal className="shell mt-8">
        <div className="overflow-hidden rounded-xl border border-line shadow-lg">
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

      <div className="shell mt-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.n}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* The desk's claim beside its explanation, one row: centred and
                stacked, this pair and the three points under it ran to 500px
                below a screenshot that had already made the point. */}
            <div className="grid gap-4 lg:grid-cols-12 lg:gap-12">
              <h3 className="text-balance font-display text-h3 font-bold text-heading lg:col-span-5">
                {current.title[lang]}
              </h3>
              <p className="max-w-[62ch] text-body text-ink-dim lg:col-span-7">
                {current.body[lang]}
              </p>
            </div>

            {/* Hairlines, not cards — the same reasoning as the capability grid.
                A row of three boxes is a component; three columns divided by a
                rule is a page. */}
            <ul className="mt-8 grid gap-px border-y border-line bg-line sm:grid-cols-3">
              {current.points.map((point) => (
                <li
                  key={point.en}
                  className="bg-paper py-5 text-small text-ink-dim sm:px-5 sm:first:ps-0"
                >
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
