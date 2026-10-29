import { type Lang, proof } from '@/content/copy'

/**
 * Four checkable facts on one hairline band, under the hero.
 *
 * This was two rows: the four transport modes as words, and the counts as a
 * centred run of 13px captions. The modes moved up into the hero's facts line,
 * where they sit beside ZATCA and the UAE, so what is left here is the counts,
 * as a four-column ledger: a figure and what it counts, start-aligned so the
 * eye can run down them. Every one of them can be checked in the demo, and
 * none is a saving or a speed-up.
 */
export function Modes({ lang }: { lang: Lang }) {
  return (
    <section className="mt-12 border-y border-line lg:mt-14">
      <dl className="shell grid grid-cols-2 lg:grid-cols-4">
        {proof.map((item, index) => (
          <div
            key={item.value + index}
            className={`flex items-baseline gap-3 py-5 lg:px-6 lg:first:ps-0 ${
              index > 0 ? 'lg:border-s lg:border-line' : ''
            } ${index % 2 === 1 ? 'ps-4 max-lg:border-s max-lg:border-line' : ''}`}
          >
            {/* The figure at heading size, not display size: a row of huge
                numbers under a hero is the stats-bar template, and a count is
                no more checkable at 48px than at 20px. */}
            <dd className="figures order-1 font-mono text-h3 font-semibold text-ink">
              {item.value}
            </dd>
            <dt className="order-2 text-small text-ink-dim">{item.label[lang]}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}
