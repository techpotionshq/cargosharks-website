'use client'

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { bilingual, type Lang } from '@/content/copy'

/**
 * The one light section on a dark page, and the one interactive claim.
 *
 * A page that asserts "fully bilingual" is making the same noise as every
 * other page in the category. A control that flips a real screenshot between
 * two real captures — and mirrors the frame around it while it does — settles
 * the question in about a second, which is roughly how long it takes a buyer
 * who works in Arabic to decide the same thing about a product they are shown.
 *
 * The section starts on the language the reader is *not* in. On the English
 * page the frame opens in Arabic, because "it does Arabic too" is the claim
 * being tested; on the Arabic page it opens in Arabic as well, because
 * demonstrating Arabic to an Arabic reader by first showing them English is
 * the exact apology this section exists to avoid.
 */
export function Bilingual({ lang }: { lang: Lang }) {
  const [shown, setShown] = useState<Lang>('ar')
  const reduced = useReducedMotion()

  const options: { key: Lang; label: string }[] = [
    { key: 'en', label: 'English' },
    { key: 'ar', label: 'العربية' },
  ]

  return (
    <section className="bg-paper py-band-sm text-ink-dark lg:py-band">
      <div className="shell grid items-center gap-14 lg:grid-cols-12 lg:gap-x-14">
        <div className="lg:col-span-5">
          <p className="tracked text-[0.68rem] text-ink-dark-dim">{bilingual.eyebrow[lang]}</p>
          <h2 className="mt-5 font-display text-[clamp(1.85rem,3.6vw,2.9rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            {bilingual.title[lang]}
          </h2>
          <p className="mt-6 max-w-[44ch] text-[1.0625rem] leading-[1.7] text-ink-dark-dim">
            {bilingual.body[lang]}
          </p>
          <p className="mt-8 border-s-2 border-edge-dark ps-5 text-[0.9375rem] leading-[1.7] text-ink-dark-dim">
            {bilingual.aside[lang]}
          </p>
        </div>

        <div className="lg:col-span-7">
          <div className="mb-4 flex items-center justify-end gap-3">
            <span className="tracked text-[0.62rem] text-ink-dark-dim">{bilingual.toggleHint[lang]}</span>
            <div
              role="group"
              className="inline-flex rounded-full border border-edge-dark bg-paper-sunk p-0.5"
            >
              {options.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setShown(option.key)}
                  aria-pressed={shown === option.key}
                  lang={option.key}
                  className={`relative isolate rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    option.key === 'ar' ? 'arabic' : ''
                  } ${shown === option.key ? 'text-on-brand' : 'text-ink-dark-dim hover:text-ink-dark'}`}
                >
                  {shown === option.key ? (
                    <motion.span
                      layoutId="lang-pill"
                      className="absolute inset-0 -z-10 rounded-full bg-blue"
                      transition={{ duration: reduced ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
                    />
                  ) : null}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* `dir` on the frame, not on a stylesheet: the window chrome, the
              corner radius that follows it and the caption all mirror because
              the browser mirrors them, which is the same mechanism the product
              relies on. */}
          <div
            dir={shown === 'ar' ? 'rtl' : 'ltr'}
            className="overflow-hidden rounded-xl border border-edge-dark bg-paper-sunk shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-edge-dark px-4 py-2.5">
              <span className="h-2 w-2 rounded-full bg-edge-dark" />
              <span className="h-2 w-2 rounded-full bg-edge-dark" />
              <span className="h-2 w-2 rounded-full bg-edge-dark" />
              <span
                className={`ms-3 text-[0.68rem] text-ink-dark-dim ${shown === 'ar' ? 'arabic' : 'font-mono'}`}
                lang={shown}
              >
                {shown === 'ar' ? 'الشحنات الجارية' : 'Active shipments'}
              </span>
            </div>
            <div className="relative aspect-[2360/1619]">
              <AnimatePresence initial={false} mode="popLayout">
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
      </div>
    </section>
  )
}
