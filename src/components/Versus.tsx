import { ArrowRight, Check, X } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { Band, SectionHead } from '@/components/Section'
import type { Lang } from '@/content/copy'
import { versus } from '@/content/home'

/**
 * Before and after, one row per moment in a job.
 *
 * A table rather than cards because the comparison is the content: a reader's
 * eye has to be able to go straight across a row. On a phone the columns stack
 * inside each row, with the "before" line kept short enough that the row still
 * reads as a pair.
 */
export function Versus({ lang }: { lang: Lang }) {
  return (
    <Band tone="sunk" className="border-y border-line">
      <div className="shell">
        <SectionHead eyebrow={versus.eyebrow[lang]} title={versus.title[lang]} />

        <Reveal className="mx-auto mt-14 max-w-5xl">
          <div className="overflow-hidden rounded-2xl border border-line bg-paper-lift shadow-sm">
            <div className="hidden grid-cols-[1fr_1.3fr_1.5fr] border-b border-line text-[0.85rem] font-semibold md:grid">
              <span className="px-6 py-4" />
              <span className="px-6 py-4 text-ink-faint">{versus.before[lang]}</span>
              <span className="bg-blue-wash px-6 py-4 text-blue-ink">{versus.after[lang]}</span>
            </div>

            <dl className="divide-y divide-line">
              {versus.rows.map((row) => (
                <div key={row.topic.en} className="grid md:grid-cols-[1fr_1.3fr_1.5fr]">
                  <dt className="px-6 pt-5 text-[0.95rem] font-semibold text-ink md:py-5">
                    {row.topic[lang]}
                  </dt>
                  <dd className="flex items-start gap-2.5 px-6 pt-3 text-[0.95rem] leading-[1.5] text-ink-dim md:py-5">
                    <X
                      weight="bold"
                      className="mt-0.5 size-4 shrink-0 text-ink-faint"
                      aria-hidden="true"
                    />
                    {row.before[lang]}
                  </dd>
                  <dd className="flex items-start gap-2.5 px-6 pt-2 pb-5 text-[0.95rem] font-medium leading-[1.5] text-ink md:bg-blue-wash/60 md:py-5">
                    <Check
                      weight="bold"
                      className="mt-0.5 size-4 shrink-0 text-blue"
                      aria-hidden="true"
                    />
                    {row.after[lang]}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="mt-8 text-center">
            {/* Inline, not flex: on a phone the sentence wraps, and the arrow
                should follow its last word rather than float beside the block. */}
            <a href="/compare/" className="group text-[0.98rem] font-semibold text-blue-ink">
              {versus.compare[lang]}
              <ArrowRight
                weight="bold"
                className="ms-2 inline-block size-4 align-[-0.15em] transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
              />
            </a>
          </p>
        </Reveal>
      </div>
    </Band>
  )
}
