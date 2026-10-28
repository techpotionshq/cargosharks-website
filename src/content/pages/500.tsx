import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { EmailLink } from '@/components/Email'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'

/**
 * The server-error page, on the same masthead as the market pages and the 404.
 *
 * Short on purpose: what happened, that reloading once is worth it, and a way
 * on. It used to say this site keeps nothing and has no database; the blog
 * and the demo form put that out of date, and an error page is the last place
 * to be caught saying something untrue. There is no reference number to quote,
 * because inventing one for a page that logs nothing would be worse than
 * having none: the address and the time are what we ask for instead.
 *
 * It renders the header and footer itself rather than sitting in `DocPage`,
 * whose stylesheet sets `a { color: inherit }` unlayered and would beat every
 * Tailwind colour below.
 */
const WAYS = [
  { href: '/', label: 'The home page' },
  { href: '/freight-forwarding-software-kuwait/', label: 'Freight forwarding software for Kuwait' },
  { href: '/freight-forwarding-software-uae/', label: 'Freight forwarding software for the UAE' },
  {
    href: '/freight-forwarding-software-saudi-arabia/',
    label: 'Freight forwarding software for Saudi Arabia',
  },
  { href: '/blog/', label: 'The blog' },
]

export function ServerErrorContent() {
  return (
    <>
      <Header lang="en" alternate="/ar/" mark={<Wordmark tone="onDark" height={24} />} />
      <main id="top">
        <section className="bg-void pt-32 pb-16 text-on-void lg:pt-36 lg:pb-20">
          <div className="shell">
            <h1 className="max-w-[22ch] text-balance font-display text-display font-extrabold">
              Something went wrong on our side.
            </h1>
            <p className="mt-6 max-w-[58ch] text-lede text-on-void-dim">
              The request reached us and we failed to answer it. That is our fault, not yours.
              Reload the page once: most errors like this are a single request that went wrong,
              not a site that is down.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href="/#demo">Book a demo</a>
              </Button>
              <Button asChild size="lg" variant="onDark">
                <a href="/">The home page</a>
              </Button>
            </div>
          </div>
        </section>

        <Section space="tight">
          <div className="shell grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <h2 className="font-display text-h3 font-bold text-heading">
                Where to go from here
              </h2>
              <p className="mt-3 max-w-[40ch] text-body text-ink-dim">
                If it keeps happening, tell us the address and roughly when at{' '}
                <EmailLink
                  subject="Server error on cargosharks.com"
                  className="text-blue-ink hover:underline"
                />
                . A named person replies.
              </p>
            </div>
            <ul className="divide-y divide-line border-y border-line lg:col-span-7">
              {WAYS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="group flex min-h-12 items-center justify-between gap-4 py-3 text-body font-semibold text-ink transition-colors hover:text-blue-ink"
                  >
                    {link.label}
                    <ArrowRight
                      weight="bold"
                      className="size-4 shrink-0 text-ink-faint group-hover:text-blue-ink rtl:-scale-x-100"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </main>
      <Footer lang="en" alternate="/ar/" mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}
