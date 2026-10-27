import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { cta, DEMO_URL, type Lang } from '@/content/copy'
import { EmailLink } from './Email'

/**
 * The close, and the page's second and last photograph of the sea.
 *
 * What was here originally was a headline beside a card printing three email
 * addresses and a password. Credentials as the last thing a prospect sees read
 * as a support article rather than an invitation, and they are already on the
 * demo's own sign-in screen, which is where somebody who wants them is looking.
 *
 * The hero opens on a port at dusk and this closes on a ship at sea, which is
 * the only piece of symmetry the page allows itself. A horizon is what a page
 * stops on — the same reason a film's last shot pulls back — and both bands are
 * dark for the same reason a printed brochure has a cover and a back cover.
 *
 * The check-marked list of three reassurances that used to sit under the buttons
 * is gone: "No sign-up · Three roles · Arabic and English" was three ticks in a
 * row saying what the paragraph directly above them had already said, which is
 * the padding every generated close carries.
 */
export function Cta({ lang }: { lang: Lang }) {
  return (
    <section
      id="demo"
      className="relative isolate scroll-mt-28 overflow-hidden py-band-sm lg:py-band"
    >
      <img
        src="/pic/photos/ship-aerial.webp"
        alt=""
        width={1600}
        height={1067}
        loading="lazy"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-void/80" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-void via-transparent to-void" />

      <Reveal className="shell relative flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-blue-lit">{cta.eyebrow[lang]}</p>

        <h2 className="mt-6 max-w-[18ch] text-balance font-display text-[clamp(2.1rem,4.8vw,3.4rem)] font-medium leading-[1.08] tracking-[-0.02em] text-on-void">
          {cta.title[lang]}
        </h2>

        <p className="mt-7 max-w-[54ch] text-balance text-[1.0625rem] leading-[1.7] text-on-void-dim">
          {cta.body[lang]}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={DEMO_URL}
            className="tracked group flex items-center gap-2.5 rounded-lg bg-blue px-7 py-4 text-[0.66rem] leading-none text-on-brand transition-opacity hover:opacity-90"
          >
            {cta.primary[lang]}
            <ArrowRight
              weight="bold"
              className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
            />
          </a>
          <EmailLink className="tracked rounded-lg border border-on-void-faint/40 px-7 py-4 text-[0.66rem] leading-none text-on-void transition-colors hover:bg-void-lift">
            {cta.secondary[lang]}
          </EmailLink>
        </div>
      </Reveal>
    </section>
  )
}
