import type { ComponentType } from 'react'
import {
  ArrowRight,
  Buildings,
  ChatsCircle,
  Check,
  ClockCounterClockwise,
  Package,
  Percent,
  Receipt,
  Tag,
  Truck,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '@/components/Reveal'
import { Band, SectionHead } from '@/components/Section'
import { hrefFor, type Lang } from '@/content/copy'
import { desks } from '@/content/home'

type Glyph = ComponentType<{ weight?: 'duotone' | 'bold'; className?: string }>

const DESK_ICONS: Record<string, Glyph> = {
  commercial: Tag,
  operations: Package,
  finance: Receipt,
}

const EXTRA_ICONS: Record<string, Glyph> = {
  chat: ChatsCircle,
  portal: UsersThree,
  modes: Truck,
  branches: Buildings,
  history: ClockCounterClockwise,
  tax: Percent,
}

/**
 * The three desks, each as a claim beside its own screen, then the rest.
 *
 * This replaces two sections: a tab rail that showed one desk at a time and
 * rotated on a timer, and a text-only grid of five mechanisms. The tabs hid
 * two thirds of the product behind a click most readers never made, and the
 * grid described screens without showing any. Alternating rows let a reader
 * scroll past all three desks with the screen and the sentence about it side by
 * side, which is the one layout in which a screenshot is read rather than
 * glanced at.
 *
 * The screens sit on a sunk mat rather than straight on the page: a capture
 * of a light interface on a light page has no edge, and a mat gives it one
 * without a heavy frame.
 */
export function Desks({ lang, shotSuffix }: { lang: Lang; shotSuffix: string }) {
  return (
    <Band id="work" tone="lift" className="border-y border-line">
      <div className="shell">
        <SectionHead
          eyebrow={desks.eyebrow[lang]}
          title={desks.title[lang]}
          sub={desks.sub[lang]}
        />
      </div>

      <div className="shell-wide mt-16 space-y-20 lg:mt-20 lg:space-y-28">
        {desks.rows.map((row, index) => {
          const Icon = DESK_ICONS[row.icon] ?? Tag
          const flip = index % 2 === 1

          return (
            <div key={row.shot} className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
              <Reveal className={`lg:col-span-5 ${flip ? 'lg:order-2' : ''}`}>
                <p className="inline-flex items-center gap-2 rounded-full bg-blue-wash px-3 py-1 text-[0.85rem] font-semibold text-blue-ink">
                  <Icon weight="bold" className="size-4" />
                  {row.desk[lang]}
                </p>
                <h3 className="mt-5 text-balance font-display text-[clamp(1.6rem,2.8vw,2.2rem)] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
                  {row.title[lang]}
                </h3>
                <p className="mt-5 text-[1.05rem] leading-[1.7] text-ink-dim">{row.body[lang]}</p>
                <ul className="mt-7 space-y-3">
                  {row.points.map((point) => (
                    <li
                      key={point.en}
                      className="flex items-start gap-3 text-[0.98rem] leading-[1.5] text-ink"
                    >
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-blue text-on-brand">
                        <Check weight="bold" className="size-3" aria-hidden="true" />
                      </span>
                      {point[lang]}
                    </li>
                  ))}
                </ul>
                <a
                  href={hrefFor(row.link, lang)}
                  className="group mt-8 inline-flex items-center gap-2 text-[0.98rem] font-semibold text-blue-ink"
                >
                  {row.link.label[lang]}
                  <ArrowRight
                    weight="bold"
                    className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
                  />
                </a>
              </Reveal>

              <Reveal className={`lg:col-span-7 ${flip ? 'lg:order-1' : ''}`} delay={0.06}>
                <div className="rounded-3xl bg-paper-sunk p-3 sm:p-5">
                  <div className="overflow-hidden rounded-xl border border-line bg-paper-lift shadow-xl">
                    <img
                      src={`/pic/screens/${row.shot}${shotSuffix}.webp`}
                      alt=""
                      width={2360}
                      height={1476}
                      loading="lazy"
                      className="w-full"
                    />
                  </div>
                </div>
              </Reveal>
            </div>
          )
        })}
      </div>

      <div className="shell mt-24 lg:mt-32">
        <Reveal>
          <h3 className="text-center font-display text-[1.4rem] font-semibold tracking-[-0.01em] text-ink">
            {desks.extrasTitle[lang]}
          </h3>
        </Reveal>
        <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {desks.extras.map((extra) => {
            const Icon = EXTRA_ICONS[extra.icon] ?? Truck
            return (
              <div key={extra.icon} className="bg-paper-lift p-7">
                <Icon weight="duotone" className="size-7 text-blue" />
                <h4 className="mt-4 text-[1.05rem] font-semibold text-ink">{extra.title[lang]}</h4>
                <p className="mt-2 text-[0.95rem] leading-[1.6] text-ink-dim">{extra.body[lang]}</p>
              </div>
            )
          })}
        </div>
      </div>
    </Band>
  )
}
