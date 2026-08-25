import { Reveal } from '@/components/Reveal'
import { type Lang, modes, modesNote, proof } from '@/content/copy'

/**
 * The five modes and the five counts, on one hairline band.
 *
 * These were two sections. The modes had thin icons and a mono caption; the
 * counts were a five-cell strip with figures at 2.1rem — the "stats bar" every
 * B2B page carries, and one of the clearest tells that a page was assembled
 * from parts rather than composed. A row of enormous numbers directly under a
 * hero is a page shouting before it has said anything.
 *
 * Merged and quietened, they do the job the strip was actually for: a beat
 * after the hero that says who this is for and gives one checkable fact, in
 * passing, at the size of a caption. The figures are set at about a third of
 * what they were. They lose nothing by it — a number is checkable or it is not,
 * and 32px of it is no more checkable than 15px.
 *
 * Every count here is countable in the repository, and `apps/landing/README.md`
 * records the command for each. That is the difference between this and the
 * "10× faster, 99.9% uptime" band: these can only be wrong by going stale, and
 * going stale is a thing a person can be asked to check.
 */
const MODE_GLYPH = {
  sea: 'sea',
  air: 'air',
  road: 'road',
  rail: 'rail',
  courier: 'courier',
} as const

export function Modes({ lang }: { lang: Lang }) {
  return (
    <section className="mt-14 border-y border-line lg:mt-16">
      <Reveal className="shell flex flex-col items-center gap-6 py-8 text-center">
        <p className="tracked text-[0.6rem] text-ink-faint">{modesNote[lang]}</p>

        {/* The modes as words, divided by hairlines. They had a Phosphor glyph
            each — a boat, a plane, a truck, a train, a parcel — which is five
            pictograms saying exactly what the five words beside them said. */}
        <ul className="flex flex-wrap items-center justify-center">
          {modes.map((mode, index) => (
            <li
              key={mode.key}
              data-glyph={MODE_GLYPH[mode.key as keyof typeof MODE_GLYPH]}
              className={`px-5 text-[1rem] text-ink-dim transition-colors duration-200 hover:text-ink sm:px-7 ${
                index > 0 ? 'border-s border-line' : ''
              }`}
            >
              {mode.label[lang]}
            </li>
          ))}
        </ul>
      </Reveal>

      <div className="border-t border-line">
        <div className="shell flex flex-wrap items-baseline justify-center gap-x-8 gap-y-2 py-5 sm:gap-x-12">
          {proof.map((item, index) => (
            <p key={item.value + index} className="flex items-baseline gap-2 text-[0.8rem]">
              <span className="figures font-mono font-medium text-ink">{item.value}</span>
              <span className="text-ink-faint">{item.label[lang]}</span>
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}
