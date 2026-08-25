import { AirplaneTilt, Boat, Package, Train, Truck } from '@phosphor-icons/react/dist/ssr'
import { type Lang, modes, modesNote } from '@/content/copy'

/**
 * The five modes, named.
 *
 * This is the band that would be a logo wall on any other site in the category,
 * and a logo wall is not available: the product is in pilot, so the honest
 * version of that strip is empty. What goes there instead has to do the same
 * job — buy the reader a moment of "yes, this is for me" immediately after the
 * hero — without claiming customers that do not exist yet.
 *
 * Naming the modes does it. `proof` counts them a section later, and a count is
 * something a reader takes on trust; an air-only broker reading "5 transport
 * modes" has learned nothing and the same broker reading "Air" has learned the
 * one thing they came for. It is also the cheapest disqualifier on the page,
 * which is worth as much: a page that lets the wrong reader leave in four
 * seconds is doing them and the sales desk a favour.
 */
const MODE_ICONS = {
  sea: Boat,
  air: AirplaneTilt,
  road: Truck,
  rail: Train,
  courier: Package,
} as const

export function Modes({ lang }: { lang: Lang }) {
  return (
    <section className="relative z-10 border-y border-edge bg-deep/60">
      {/* Stacked and centred rather than a label at one end and the modes at
          the other. Justified apart, the row was two objects at opposite edges
          of a 1200px band with nothing between them — the label read as a
          stray caption and the modes as a menu. Centred under their own label
          they read as one statement, which is what they are. */}
      <div className="shell flex flex-col items-center gap-6 py-10">
        <p className="tracked text-[0.62rem] text-ink-faint">{modesNote[lang]}</p>

        <ul className="flex flex-wrap items-center justify-center gap-x-9 gap-y-5 sm:gap-x-14">
          {modes.map((mode) => {
            const Icon = MODE_ICONS[mode.key as keyof typeof MODE_ICONS]

            return (
              <li key={mode.key} className="flex items-center gap-2.5 text-ink-dim">
                <Icon weight="regular" className="size-[1.35rem] text-blue-lit" />
                <span className="text-[0.95rem]">{mode.label[lang]}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
