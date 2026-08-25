import { type Lang, proof } from '@/content/copy'

/**
 * Five counts, and every one of them is checkable.
 *
 * That is the entire design brief for this band. The equivalent strip on most
 * sites in this category carries "10× faster" and "99.9% uptime", which cannot
 * be checked and therefore cannot be believed; these are counts of things in
 * the repository, so the only way they can be wrong is by going stale, and
 * `apps/landing/README.md` records the command that re-checks each one.
 *
 * The last figure is the one that does the most work. "Three decimals on every
 * dinar" means nothing to a general reader and means a great deal to anyone who
 * has watched a system built for dollars round a Kuwaiti invoice to two.
 */
export function Proof({ lang }: { lang: Lang }) {
  return (
    <section className="border-y border-edge bg-deep">
      <div className="shell grid grid-cols-2 md:grid-cols-5">
        {proof.map((item, index) => (
          <div
            key={item.value + index}
            className="border-edge px-4 py-9 text-center max-md:border-b max-md:last:border-b-0 md:border-e md:last:border-e-0"
          >
            <p className="figures font-mono text-[2.1rem] font-medium leading-none text-ink">{item.value}</p>
            <p className="tracked mt-3 indent-[0.16em] text-[0.62rem] leading-[1.5] text-ink-faint">{item.label[lang]}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
