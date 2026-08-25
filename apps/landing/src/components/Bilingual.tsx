'use client'

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { bilingual, type Lang } from '@/content/copy'

/**
 * The one interactive claim on the page, now that the page is light.
 *
 * A site that asserts "fully bilingual" is making the same noise as every other
 * site in the category. A control that flips a real screenshot between two real
 * captures — and mirrors the window chrome around it while it does — settles
 * the question in about a second, which is roughly how long it takes a buyer
 * who works in Arabic to decide the same thing about a product they are shown.
 *
 * The section starts on the language the reader is *not* in. On the English
 * page the frame opens in Arabic, because "it does Arabic too" is the claim
 * being tested; on the Arabic page it opens in Arabic as well, because
 * demonstrating Arabic to an Arabic reader by first showing them English is the
 * exact apology this section exists to avoid.
 *
 * **This used to be the one light band on a dark page and is now the one sunk
 * band on a light one.** The inversion cost nothing, because what the section
 * needed was never lightness — it was separation. It is the only part of the
 * argument that is a demonstration rather than a statement, and it should feel
 * like stepping into a different room.
 */
export function Bilingual({ lang }: { lang: Lang }) {
  const [shown, setShown] = useState<Lang>('ar')
  const reduced = useReducedMotion()

  const options: { key: Lang; label: string }[] = [
    { key: 'en', label: 'English' },
    { key: 'ar', label: 'العربية' },
  ]

  return (
    <section className="border-t border-line bg-paper-sunk py-band-sm lg:py-band">
      <div className="shell flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-ink-faint">{bilingual.eyebrow[lang]}</p>

        <h2 className="mt-5 max-w-[22ch] text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.02em]">
          {bilingual.title[lang]}
        </h2>

        <p className="mt-6 max-w-[60ch] text-balance text-[1.0625rem] leading-[1.7] text-ink-dim">
          {bilingual.body[lang]}
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <span className="tracked text-[0.58rem] text-ink-faint">{bilingual.toggleHint[lang]}</span>
          <div role="group" className="inline-flex rounded-lg border border-line-strong bg-paper p-1">
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setShown(option.key)}
                aria-pressed={shown === option.key}
                lang={option.key}
                className={`relative isolate rounded-md px-5 py-2 text-sm font-medium transition-colors ${
                  option.key === 'ar' ? 'arabic' : ''
                } ${shown === option.key ? 'text-on-brand' : 'text-ink-dim hover:text-ink'}`}
              >
                {shown === option.key ? (
                  <motion.span
                    layoutId="lang-pill"
                    className="absolute inset-0 -z-10 rounded-md bg-blue"
                    transition={{ duration: reduced ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                  />
                ) : null}
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* `dir` on the frame, not on a stylesheet: the window chrome, the corner
          radius that follows it and the caption all mirror because the browser
          mirrors them, which is the same mechanism the product relies on. This
          is the one frame on the site whose chrome is the demonstration rather
          than the container, which is why it draws its own. */}
      <div className="shell-wide mt-12">
        <div
          dir={shown === 'ar' ? 'rtl' : 'ltr'}
          className="mx-auto overflow-hidden rounded-2xl border border-line shadow-xl"
        >
          <div className="bg-paper-lift">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span
                className={`ms-3 text-[0.7rem] text-ink-faint ${shown === 'ar' ? 'arabic' : 'font-mono'}`}
                lang={shown}
              >
                {shown === 'ar' ? 'الشحنات الجارية' : 'Active shipments'}
              </span>
            </div>
            <div className="relative aspect-[2360/1619]">
              <AnimatePresence initial={false}>
                <motion.img
                  key={shown}
                  src={shown === 'ar' ? '/pic/screens/arabic.webp' : '/pic/screens/english.webp'}
                  alt={
                    shown === 'ar'
                      ? 'لوحة الشحنات الجارية بالعربية'
                      : 'The active shipments board in English'
                  }
                  width={2360}
                  height={1619}
                  loading="lazy"
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 h-full w-full"
                />
              </AnimatePresence>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-[56ch] border-t border-line pt-7 text-center text-[0.9375rem] leading-[1.7] text-ink-dim">
          {bilingual.aside[lang]}
        </p>
      </div>
    </section>
  )
}
