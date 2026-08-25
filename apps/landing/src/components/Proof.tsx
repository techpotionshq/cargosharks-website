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
 *
 * **The dividers are hairlines that fade at both ends, not full-height rules.**
 * Five cells boxed by five borders is a table, and a table of numbers with no
 * headers is the least persuasive object on a marketing page. Fading them out
 * top and bottom leaves the figures grouped without looking tabulated — the
 * separation is still there, it has just stopped being furniture.
 */
export function Proof({ lang }: { lang: Lang }) {
  return (
    <section className="border-b border-edge py-14 lg:py-16">
      <div className="shell grid grid-cols-2 gap-y-10 md:grid-cols-5">
        {proof.map((item, index) => (
          <div
            key={item.value + index}
            className="relative px-4 text-center"
          >
            {/* Not on the first cell of each row, and drawn as a gradient so it
                is brightest where the figures are and gone by the cell's edge. */}
            {index % 2 !== 0 || index >= 3 ? (
              <span
                aria-hidden="true"
                className="absolute inset-y-1 start-0 w-px bg-gradient-to-b from-transparent via-edge-lit to-transparent max-md:hidden"
              />
            ) : null}
            {index % 2 !== 0 ? (
              <span
                aria-hidden="true"
                className="absolute inset-y-1 start-0 w-px bg-gradient-to-b from-transparent via-edge-lit to-transparent md:hidden"
              />
            ) : null}

            <p className="figures font-mono text-[clamp(2rem,3.4vw,2.6rem)] font-medium leading-none text-ink">
              {item.value}
            </p>
            <p className="tracked mx-auto mt-3.5 max-w-[22ch] indent-[0.16em] text-[0.6rem] leading-[1.6] text-ink-faint">
              {item.label[lang]}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
