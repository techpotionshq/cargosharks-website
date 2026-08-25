'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChatCircleText, Path, Receipt } from '@phosphor-icons/react/dist/ssr'
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

/**
 * Three stages of the file, with the screenshot pinned and the copy scrolling
 * past it.
 *
 * The version this replaces gave each stage its own full section with its own
 * heading, its own screenshot and its own three bullets — the same shape three
 * times in a row, which is what makes a long page feel padded rather than
 * thorough. Pinning the frame turns three sections into one: the reader keeps
 * looking at the product while the argument moves, and the page loses about
 * two thousand pixels without losing a sentence.
 *
 * Which stage is current is read from scroll position on every frame — see
 * `measure` below for why it is not an `IntersectionObserver`.
 */
export function Work({ lang, shotSuffix }: { lang: Lang; shotSuffix: string }) {
  const [active, setActive] = useState(0)
  const blocks = useRef<(HTMLDivElement | null)[]>([])
  const reduced = useReducedMotion()

  useEffect(() => {
    const nodes = () => blocks.current.filter(Boolean) as HTMLDivElement[]
    let frame: number | null = null

    /**
     * The current stage is the last one whose top has passed the reader's eye
     * line. Deliberately monotonic, and deliberately not an
     * `IntersectionObserver`.
     *
     * It was an observer watching a band across the middle of the viewport,
     * which is the tidier code and was wrong at the one place it mattered. The
     * band is about eighty pixels tall; the last stage ends before the section
     * does, because the pinned frame needs room to unpin. So at the bottom of
     * the section no stage intersected the band, no callback fired, and
     * `active` kept whatever value it had last — which after a fast scroll was
     * stage one. The reader had the finance copy in front of them and the
     * enquiry queue beside it.
     *
     * Reading position on every frame cannot go stale that way: there is always
     * a last stage whose top has passed, so there is always an answer.
     */
    const measure = () => {
      frame = null
      const eye = window.innerHeight * 0.42
      const found = nodes().reduce(
        (best, node, index) => (node.getBoundingClientRect().top <= eye ? index : best),
        0,
      )
      setActive(found)
    }

    const request = () => {
      if (frame === null) frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', request, { passive: true })
    window.addEventListener('resize', request)
    return () => {
      window.removeEventListener('scroll', request)
      window.removeEventListener('resize', request)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  // `noUncheckedIndexedAccess` is on across the workspace, and it is right to
  // be: `active` comes from an observer callback and nothing but this line
  // guarantees it indexes a stage that exists.
  const current = steps[active] ?? steps[0]
  if (!current) return null

  return (
    <section id="work" className="relative scroll-mt-24 overflow-x-clip py-band-sm lg:py-band">
      <div className="shell">
        <p className="tracked text-[0.68rem] text-ink-faint">{work.eyebrow[lang]}</p>
        <div className="mt-5 gap-x-14 lg:flex lg:items-end lg:justify-between">
          <h2 className="max-w-[18ch] font-display text-[clamp(1.85rem,3.6vw,2.9rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            {work.title[lang]}
          </h2>
          <p className="mt-5 max-w-[46ch] text-[1.0625rem] leading-[1.7] text-ink-dim lg:mt-0">
            {work.sub[lang]}
          </p>
        </div>
      </div>

      <div className="shell mt-10 lg:mt-12 lg:grid lg:grid-cols-12 lg:gap-x-10">
        <div className="lg:col-span-5">
          {steps.map((step, index) => (
            <div
              key={step.n}
              ref={(node) => {
                blocks.current[index] = node
              }}
              className="lg:flex lg:min-h-[34rem] lg:flex-col lg:justify-center"
            >
              <StageCopy step={step} lang={lang} dim={!reduced && active !== index} />

              {/* Below `lg` there is no pinning, so each stage carries its own
                  screenshot and the sticky frame is hidden entirely. */}
              <div className="mt-8 overflow-hidden rounded-lg border border-edge-lit lg:hidden">
                <img
                  src={`/pic/screens/${step.shot}${shotSuffix}.webp`}
                  alt=""
                  width={2360}
                  height={1476}
                  loading="lazy"
                  className="w-full"
                />
              </div>
              <div className="h-16 lg:h-0" />
            </div>
          ))}
        </div>

        <div className="hidden lg:col-span-7 lg:block">
          <div className="sticky top-[6.5rem]">
            <div className="relative aspect-[2360/1475] w-[54rem] max-w-none">
              <div className="bloom pointer-events-none absolute inset-[12%] -z-10" />
              <AnimatePresence initial={false}>
                <motion.img
                  key={current.shot}
                  src={`/pic/screens/${current.shot}${shotSuffix}.webp`}
                  alt=""
                  width={2360}
                  height={1475}
                  initial={reduced ? false : { opacity: 0, scale: 1.012 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0 h-full w-full rounded-xl border border-edge-lit shadow-2xl"
                />
              </AnimatePresence>
            </div>

            {/* The progress rail stays inside the shell rather than following
                the frame off the edge — it is chrome, and chrome that bleeds
                reads as an accident. */}
            <ol className="mt-7 flex w-[34rem] items-center gap-2" aria-hidden="true">
              {steps.map((step, index) => (
                <li
                  key={step.n}
                  className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                    index === active ? 'bg-blue-lit' : 'bg-edge-lit'
                  }`}
                />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  )
}

function StageCopy({
  step,
  lang,
  dim,
}: {
  step: (typeof steps)[number]
  lang: Lang
  dim: boolean
}) {
  const Icon = STEP_ICONS[step.icon as keyof typeof STEP_ICONS]

  return (
    <div className={`transition-opacity duration-500 ${dim ? 'lg:opacity-35' : 'opacity-100'}`}>
      <p className="tracked flex items-center gap-2.5 text-[0.68rem] text-blue-lit">
        <Icon weight="regular" className="size-4" />
        {step.n}
      </p>
      <h3 className="mt-4 font-display text-[clamp(1.5rem,2.6vw,2.05rem)] font-bold leading-[1.15] tracking-[-0.025em]">
        {step.title[lang]}
      </h3>
      <p className="mt-5 max-w-[42ch] text-[1.0625rem] leading-[1.7] text-ink-dim">{step.body[lang]}</p>
      <ul className="mt-7 space-y-3.5 border-t border-edge pt-7">
        {step.points.map((point) => (
          <li key={point.en} className="flex gap-3.5 text-[0.9375rem] leading-[1.6] text-ink-faint">
            <span aria-hidden="true" className="mt-[0.55em] h-px w-4 shrink-0 bg-edge-lit" />
            {point[lang]}
          </li>
        ))}
      </ul>
    </div>
  )
}
