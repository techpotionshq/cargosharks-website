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
 * This is the one place on the page where centring earns its keep. Everything
 * above is asymmetric on purpose, so a single centred column at the end reads
 * as the page stopping and asking a question rather than as another band.
 */
export function Cta({ lang }: { lang: Lang }) {
  return (
    <section id="demo" className="relative scroll-mt-24 overflow-hidden border-t border-edge py-band-sm lg:py-band">
      <div className="grid-field pointer-events-none absolute inset-0" />
      {/* One soft light behind the headline. It is the only gradient on the
          page and it is doing the job a spotlight does on a stage. */}
      <div className="bloom pointer-events-none absolute start-1/2 top-[18%] h-64 w-[38rem] -translate-x-1/2 rtl:translate-x-1/2" />

      <div className="shell relative flex flex-col items-center text-center">
        <p className="tracked text-[0.68rem] text-blue-lit">{cta.eyebrow[lang]}</p>

        <h2 className="mt-6 max-w-[18ch] font-display text-[clamp(2rem,4.4vw,3.4rem)] font-extrabold leading-[1.06] tracking-[-0.035em]">
          {cta.title[lang]}
        </h2>

        <p className="mt-7 max-w-[54ch] text-[1.0625rem] leading-[1.7] text-ink-dim">{cta.body[lang]}</p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={DEMO_URL}
            className="group flex items-center gap-2 rounded-full bg-blue px-7 py-4 text-[1rem] font-semibold text-on-brand transition-transform hover:scale-[1.03] active:scale-100"
          >
            {cta.primary[lang]}
            <ArrowRight
              weight="bold"
              className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
            />
          </a>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="rounded-full border border-edge-lit px-7 py-4 text-[1rem] font-medium text-ink transition-colors hover:bg-raise"
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
