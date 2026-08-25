import type { ComponentType } from 'react'
import {
  CurrencyCircleDollar,
  FileText,
  Path,
  ShieldCheck,
  Table,
} from '@phosphor-icons/react/dist/ssr'
import { capabilities, type Lang } from '@/content/copy'

/**
 * A thin outline glyph at the foot of each cell, at low emphasis.
 *
 * Not the rounded-square chip these used to sit in at the *top* of a card. The
 * difference is not decoration versus no decoration, it is rank: a filled chip
 * above the heading competes with the heading, and a hairline glyph below the
 * paragraph closes the cell. CargoWise's grid does exactly this and it is the
 * reason that grid reads as a document rather than as a component library.
 */
const CELL_ICONS: Record<string, ComponentType<{ weight?: 'thin'; className?: string }>> = {
  route: Path,
  money: CurrencyCircleDollar,
  rates: Table,
  docs: FileText,
  tenancy: ShieldCheck,
}

/**
 * Five mechanisms, in cells divided by hairlines.
 *
 * This was a "bento": five floating cards with 16px radii, a rounded-square
 * chip holding a Phosphor glyph at the top of each, and a hover border. That
 * arrangement is the single most-generated block on the internet right now, and
 * the icon chips were the worst part of it — five decorative glyphs that
 * repeat what the heading beside them already says, in a row, at equal weight,
 * so the eye reads a pattern instead of five arguments.
 *
 * CargoWise's equivalent section is cells on a plain background separated by
 * one-pixel rules, no boxes and no chips, with the type doing all the work. It
 * is better for a reason that survives fashion: a card says *this is a
 * component*, and a rule says *this is a column of a document* — and a document
 * is what a forwarder trusts.
 *
 * So: a grid whose 1px gap shows the line colour through it, cells in the paper
 * colour, headings at weight 500, and one drawing in the whole section. The
 * drawing is a berth plan and it is in the cell whose claim is about a clock
 * running on a box standing in a yard, which is the only cell a picture of a
 * yard belongs in.
 */
export function Capabilities({ lang }: { lang: Lang }) {
  return (
    <section className="border-t border-line py-band-sm lg:py-band">
      <div className="shell flex flex-col items-center text-center">
        <p className="tracked text-[0.62rem] text-ink-faint">{capabilities.eyebrow[lang]}</p>
        <h2 className="mt-5 max-w-[22ch] text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.02em]">
          {capabilities.title[lang]}
        </h2>
        <p className="mt-5 max-w-[56ch] text-balance text-[1.0625rem] leading-[1.65] text-ink-dim">
          {capabilities.sub[lang]}
        </p>
      </div>

      {/*
        `gap-px` over a line-coloured background is how the rules are drawn. The
        alternative — a border on each cell — doubles every interior rule to two
        pixels and leaves the outer edge inconsistent, which is the detail that
        makes a grid look approximate.
      */}
      {/* The rules are drawn by a line-coloured background showing through a
          one-pixel gap, which means that background has to stop where the cells
          stop. On the `.shell-wide` element itself it painted the gutter too,
          and the grid appeared to sit on a grey mat. */}
      <div className="shell-wide mt-12">
      <div className="grid gap-px border-y border-line bg-line lg:grid-cols-6">
        {capabilities.cards.map((card, index) => {
          const Icon = CELL_ICONS[card.icon]

          return (
            <article
              key={card.key}
              className={`flex flex-col bg-paper px-7 py-9 lg:px-9 lg:py-11 ${
                card.span === 'wide' ? 'lg:col-span-4' : 'lg:col-span-2'
              }`}
            >
              {/* The number is the only ornament above the heading, and it is an
                  index rather than a decoration: it says how many of these there
                  are and where you are in them, which a glyph of a shield does
                  not. */}
              <p className="tracked text-[0.58rem] text-ink-faint">
                {String(index + 1).padStart(2, '0')}
              </p>

              <h3 className="mt-6 max-w-[24ch] font-display text-[clamp(1.15rem,1.8vw,1.4rem)] font-medium leading-[1.28] tracking-[-0.015em]">
                {card.title[lang]}
              </h3>

              <p className="mt-4 max-w-[48ch] text-[0.9375rem] leading-[1.7] text-ink-dim">
                {card.body[lang]}
              </p>

              {/* `mt-auto` so the glyph sits on the cell's floor whatever the
                  paragraph above it does — and the Arabic paragraph runs longer
                  than the English in four of these five. */}
              {Icon ? (
                <p className="mt-auto pt-10 text-ink-faint/60">
                  <Icon weight="thin" className="size-7" />
                </p>
              ) : null}
            </article>
          )
        })}
      </div>
      </div>
    </section>
  )
}
