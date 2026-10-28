import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { arrow, button, SectionHead } from '@/components/Section'
import { cta, DEMO_URL, type Lang } from '@/content/copy'

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
 * It is the last section now, under the questions, so the page ends on the
 * two things a reader can do rather than on a form they have already passed.
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

      <div className="shell relative">
        <SectionHead
          dark
          eyebrow={cta.eyebrow[lang]}
          title={cta.title[lang]}
          sub={cta.body[lang]}
        />

        <Reveal className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a href={DEMO_URL} className={button.primary}>
            {cta.primary[lang]}
            <ArrowRight weight="bold" className={arrow} />
          </a>
          <a href="#pilot" className={button.secondaryDark}>
            {cta.secondary[lang]}
          </a>
        </Reveal>
      </div>
    </section>
  )
}
