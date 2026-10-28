import type { ReactNode } from 'react'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { EmailLink } from '@/components/Email'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { DEMO_URL } from '@/content/copy'
import { comparisons } from '@/content/comparisons'
import { cn } from '@/lib/utils'

/**
 * The pieces the five `/compare/` pages share, on the rebuilt system.
 *
 * They used to render inside `DocPage` on `pages.css`, with an eyebrow over
 * every heading ("01 — The question underneath") and a centred
 * heading-lead-list block per section. They now follow `SolutionPage`: header
 * and footer rendered directly, a dark masthead with the two actions, sections
 * from `Section`, and a dark tail. English only, like the pages.
 *
 * `pages.css` is still imported here for one reason: the charts these pages
 * draw (`figures.tsx`, `comparison-figures.tsx`, `comparison-leads.tsx`) are
 * styled by its `cmp-*` and `fig-*` classes, which are scoped under
 * `.doc-page`. `DocFigure` is that scope, and nothing else on these pages uses
 * the old stylesheet.
 */

export function ComparePage({ children }: { children: ReactNode }) {
  return (
    <>
      <Header lang="en" mark={<Wordmark tone="onDark" height={24} />} />
      <main id="top" dir="ltr">
        {children}
      </main>
      <Footer lang="en" mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}

/** The H1 and the two actions on the start side, `aside` on the end side. */
export function Masthead({
  title,
  lede,
  aside,
}: {
  title: ReactNode
  lede: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className="bg-void pt-32 pb-16 text-on-void lg:pt-36 lg:pb-20">
      <div className="shell grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-end lg:gap-16">
        <div className="min-w-0 lg:col-span-7">
          <h1 className="max-w-[24ch] text-balance font-display text-display font-extrabold">
            {title}
          </h1>
          <p className="mt-6 max-w-[58ch] text-lede text-on-void-dim">{lede}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href={DEMO_URL}>
                Open the live demo
                <ArrowRight weight="bold" className="size-4 rtl:-scale-x-100" />
              </a>
            </Button>
            <Button asChild size="lg" variant="onDark">
              <a href="/#demo">Book a demo</a>
            </Button>
          </div>
        </div>
        {aside ? <div className="min-w-0 lg:col-span-5">{aside}</div> : null}
      </div>
    </section>
  )
}

/** Label and value pairs on the dark masthead. */
export function DarkLedger({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-void-line border-y border-void-line">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-5 gap-4 py-3.5">
          <dt className="col-span-2 text-small text-on-void-faint">{row.label}</dt>
          <dd className="col-span-3 text-small text-on-void">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The questions a buyer checks first about us, answered in the first screen of
 * every comparison. Each is a line `scripts/blog/product-facts.md` allows.
 */
export const OUR_SPEC: { label: string; value: string }[] = [
  { label: 'Built for', value: 'Forwarders in Kuwait, the UAE and Saudi Arabia' },
  { label: 'Modes', value: 'Sea, air, road, rail and courier' },
  { label: 'Languages', value: 'Arabic and English, one build, documents in both' },
  { label: 'E-invoicing', value: 'ZATCA Phase 2 and UAE e-invoicing, in the product' },
  { label: 'Your data', value: 'Your own database, in your own instance' },
  {
    label: 'Getting started',
    value: 'Free demo call, then 15 working days of paid setup and onboarding',
  },
]

/** The dark close, as on the market pages. */
export function Tail({ heading, body }: { heading: string; body: ReactNode }) {
  return (
    <section className="bg-void py-14 text-on-void lg:py-16">
      <div className="shell flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-h2 font-extrabold">{heading}</h2>
          <p className="mt-3 max-w-[60ch] text-body text-on-void-dim">{body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Button asChild size="lg">
            <a href="/#demo">Book a demo</a>
          </Button>
          <Button asChild size="lg" variant="onDark">
            <a href={DEMO_URL}>Open the live demo</a>
          </Button>
        </div>
      </div>
    </section>
  )
}

/** Writing to us, inline. */
export function AskUs({ className }: { className?: string }) {
  return <EmailLink className={cn('text-blue-ink hover:underline', className)} />
}

/** The comparison pages as link rows; `except` drops the page you are on. */
export function ComparisonLinks({ except, dark = false }: { except?: string; dark?: boolean }) {
  return (
    <ul
      className={cn(
        'divide-y border-y',
        dark ? 'divide-void-line border-void-line' : 'divide-line border-line',
      )}
    >
      {comparisons
        .filter((item) => item.slug !== except)
        .map((item) => (
          <li key={item.slug}>
            <a
              href={`/compare/${item.slug}/`}
              className={cn(
                'group flex min-h-11 items-center justify-between gap-4 py-3 text-body font-semibold transition-colors',
                dark ? 'text-on-void hover:text-blue-lit' : 'text-ink hover:text-blue-ink',
              )}
            >
              <span>
                CargoSharks vs {item.slug === 'spreadsheets' ? 'Excel and email' : item.name}
              </span>
              <ArrowRight
                weight="bold"
                className={cn(
                  'size-4 shrink-0 rtl:-scale-x-100',
                  dark ? 'text-on-void-faint' : 'text-ink-faint group-hover:text-blue-ink',
                )}
              />
            </a>
          </li>
        ))}
    </ul>
  )
}
