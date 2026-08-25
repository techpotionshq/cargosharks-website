import { ArrowRight, Check } from '@phosphor-icons/react/dist/ssr'
import { CONTACT_EMAIL, cta, DEMO_URL, type Lang } from '@/content/copy'

/**
 * The close.
 *
 * What was here was a headline beside a card printing three email addresses and
 * a password. Credentials as the last thing a prospect sees read as a support
 * article rather than an invitation — and they are already on the demo's own
 * sign-in screen, which is where somebody who wants them is looking.
 *
 * The whole page is centred now, so centring is no longer what makes this
 * section feel like an ending. The port at dusk is. It is the only photograph
 * on the site with a horizon in it, and a horizon is what a page stops on — the
 * same reason a film's last shot pulls back. It sits behind a heavy scrim
 * because this is the one block on the page where every word is a call to
 * action and none of them may be hard to read.
 */
export function Cta({ lang }: { lang: Lang }) {
  return (
    <section
      id="demo"
      className="relative isolate scroll-mt-24 overflow-hidden border-t border-edge py-band-sm lg:py-band"
    >
      <img
        src="/pic/photos/hero-port-dusk.webp"
        alt=""
        width={2000}
        height={1333}
        loading="lazy"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-void/88" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-void via-transparent to-void" />
      {/* One soft light behind the headline — the same lamp the hero uses, so
          the page opens and closes on the same note. */}
      <div className="bloom pointer-events-none absolute start-1/2 top-[14%] -z-10 h-64 w-[38rem] -translate-x-1/2 rtl:translate-x-1/2" />

      <div className="shell relative flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-blue-lit">{cta.eyebrow[lang]}</p>

        <h2 className="mt-6 max-w-[18ch] text-balance font-display text-[clamp(2.1rem,4.8vw,3.6rem)] font-extrabold leading-[1.04] tracking-[-0.04em]">
          {cta.title[lang]}
        </h2>

        <p className="mt-7 max-w-[54ch] text-balance text-[1.0625rem] leading-[1.7] text-ink-dim">
          {cta.body[lang]}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={DEMO_URL}
            className="group flex items-center gap-2 rounded-full bg-blue px-7 py-4 text-[1rem] font-semibold text-on-brand shadow-lg transition-transform hover:scale-[1.03] active:scale-100"
          >
            {cta.primary[lang]}
            <ArrowRight
              weight="bold"
              className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
            />
          </a>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="rounded-full border border-edge-lit bg-raise/40 px-7 py-4 text-[1rem] font-medium text-ink backdrop-blur-sm transition-colors hover:bg-raise"
          >
            {cta.secondary[lang]}
          </a>
        </div>

        <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {cta.points.map((point) => (
            <li key={point.en} className="flex items-center gap-2 text-[0.875rem] text-ink-faint">
              <Check weight="bold" className="size-3.5 shrink-0 text-blue-lit" />
              {point[lang]}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
