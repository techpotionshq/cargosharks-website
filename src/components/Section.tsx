import type { ReactNode } from 'react'
import { Reveal } from '@/components/Reveal'

/**
 * The home page's shared pieces: one section heading and two buttons.
 *
 * Every section used to set its own heading by hand, at weight 500 under a
 * tracked mono eyebrow, centred. The result was eight sections that all looked
 * like the same section. One component means one decision about hierarchy, and
 * `align` lets a section sit its heading beside its content instead of above it
 * when that reads better.
 *
 * The eyebrow is sentence case in the brand blue now. Tracked uppercase mono at
 * ten pixels is a label for a data table; on a heading it read as a caption
 * nobody was meant to read.
 */
export function SectionHead({
  eyebrow,
  title,
  sub,
  align = 'center',
  dark = false,
}: {
  eyebrow?: string
  title: string
  sub?: string
  align?: 'center' | 'start'
  dark?: boolean
}) {
  const centred = align === 'center'

  return (
    <Reveal className={centred ? 'mx-auto flex max-w-3xl flex-col items-center text-center' : ''}>
      {eyebrow ? (
        <p className={`text-[0.9rem] font-semibold ${dark ? 'text-blue-lit' : 'text-blue-ink'}`}>
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={`mt-3 text-balance font-display text-[clamp(2rem,4.2vw,3.1rem)] font-semibold leading-[1.1] tracking-[-0.025em] ${
          dark ? 'text-on-void' : 'text-ink'
        } ${centred ? 'max-w-[24ch]' : 'max-w-[22ch]'}`}
      >
        {title}
      </h2>
      {sub ? (
        <p
          className={`mt-5 max-w-[56ch] text-pretty text-[1.1rem] leading-[1.65] ${
            dark ? 'text-on-void-dim' : 'text-ink-dim'
          }`}
        >
          {sub}
        </p>
      ) : null}
    </Reveal>
  )
}

/**
 * Sentence case, readable size, a little weight. These were tracked mono
 * capitals at ten pixels ("OPEN THE LIVE DEMO"), the smallest type on the page
 * on the one element a reader is meant to act on.
 */
export const button = {
  primary:
    'group inline-flex items-center justify-center gap-2 rounded-xl bg-blue px-6 py-3.5 text-[0.98rem] font-semibold leading-none text-on-brand shadow-sm transition hover:-translate-y-px hover:opacity-95',
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-paper-lift px-6 py-3.5 text-[0.98rem] font-semibold leading-none text-ink transition hover:border-ink-faint',
  secondaryDark:
    'inline-flex items-center justify-center gap-2 rounded-xl border border-void-line bg-on-void/5 px-6 py-3.5 text-[0.98rem] font-semibold leading-none text-on-void transition hover:bg-on-void/10',
}

/** `rtl:-scale-x-100`: an arrow means "onward", and onward is leftward in Arabic. */
export const arrow =
  'size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5'

export function Band({
  children,
  id,
  tone = 'paper',
  className = '',
}: {
  children: ReactNode
  id?: string
  tone?: 'paper' | 'sunk' | 'lift'
  className?: string
}) {
  const bg = tone === 'sunk' ? 'bg-paper-sunk' : tone === 'lift' ? 'bg-paper-lift' : 'bg-paper'
  return (
    <section id={id} className={`scroll-mt-28 py-band-sm lg:py-band ${bg} ${className}`}>
      {children}
    </section>
  )
}
