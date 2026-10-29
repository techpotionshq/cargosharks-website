import type { ComponentType } from 'react'
import {
  ChatsCircle,
  CurrencyCircleDollar,
  FileText,
  Path,
  ShieldCheck,
  Table,
} from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { Section, SectionHeader } from '@/components/ui/section'
import { capabilities, type Lang } from '@/content/copy'

/**
 * A small outline glyph beside each heading, at low emphasis. It sits in the
 * heading's line rather than in a chip above it, so it labels the cell without
 * competing with the words.
 */
const CELL_ICONS: Record<string, ComponentType<{ weight?: 'regular'; className?: string }>> = {
  route: Path,
  money: CurrencyCircleDollar,
  rates: Table,
  docs: FileText,
  inbox: ChatsCircle,
  tenancy: ShieldCheck,
}

/**
 * Six mechanisms, in an even three-by-two grid divided by hairlines.
 *
 * It was five cells on a six-column grid with the first spanning four, so the
 * first paragraph stopped at half its cell and left a dead half beside it, and
 * the "01"–"05" mono indexes above each heading were ornament rather than
 * information. Six equal cells read as six arguments of the same weight, which
 * is what they are.
 *
 * `gap-px` over a line-coloured background draws the rules: a border on each
 * cell doubles every interior rule. The grid moves into place as one piece:
 * cells that each slid on their own uncovered the line colour beneath them,
 * which read as a thick grey bar along the top of the grid.
 */
export function Capabilities({ lang }: { lang: Lang }) {
  return (
    <Section rule>
      <div className="shell">
        <SectionHeader title={capabilities.title[lang]} lede={capabilities.sub[lang]} />

        <Reveal className="mt-12 grid gap-px border-y border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.cards.map((card) => {
            const Icon = CELL_ICONS[card.icon]

            return (
              <article key={card.key} className="h-full bg-paper py-8 sm:px-7 lg:py-9">
                <h3 className="flex items-start gap-3 font-display text-h3 font-bold text-heading">
                  {Icon ? (
                    <Icon weight="regular" className="mt-0.5 size-5 shrink-0 text-blue-ink" />
                  ) : null}
                  {card.title[lang]}
                </h3>
                <p className="mt-3 max-w-[48ch] text-small text-ink-dim">{card.body[lang]}</p>
              </article>
            )
          })}
        </Reveal>
      </div>
    </Section>
  )
}
