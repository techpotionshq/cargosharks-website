import { ChartFigure } from '@/components/charts/ChartFigure'
import { CostShapeChart } from '@/components/charts/charts'
import type { Lang } from '@/content/copy'

/**
 * The two drawings on a comparison page, and the rule they are drawn under.
 *
 * `/compare/` §03 forbids publishing claims about somebody else's product, and
 * a chart is a claim with a shape. Both figures here are therefore about
 * *categories of thing* rather than about any vendor: neither carries a
 * competitor's name, a price, or a number attributed to anyone. They are the
 * kind of diagram a buyer draws on a whiteboard when deciding what to ask —
 * which is exactly what these pages are for.
 *
 * Both sit in `ChartFigure`, the frame every figure on the site shares: the
 * cost shape is a shadcn/Recharts chart (`CostShapeChart`), and the timeline
 * is plain Tailwind because it holds two events and nothing to plot. Neither
 * uses `pages.css`, so they render the same inside or outside `.doc-page`.
 */

/**
 * How a bill grows, by the shape of the contract rather than by the vendor.
 *
 * Per-shipment and per-transaction pricing is normal in this category, it is
 * not a trick, and this figure does not say it is. What it says is that the two
 * shapes cross — a flat bill is worse at low volume and better at high — and
 * that the crossing is the number a buyer should ask every vendor to put in
 * writing. Neither line carries a vendor's name and neither axis carries a
 * figure, because the honest version of this chart has no scale on it, and it
 * says so in its title: the shape is the whole content. The shape itself has to
 * be right, though. A flat bill is horizontal, because it does not move with
 * volume; a per-shipment bill starts at the origin, because no shipments cost
 * nothing. An earlier drawing sloped the flat line and lifted the other off
 * zero, which is a different (and wrong) pair of contracts.
 */
export function CostShape({ lang }: { lang: Lang }) {
  return (
    <ChartFigure
      title={
        lang === 'ar'
          ? 'فاتورة ثابتة مقابل فاتورة لكل شحنة مع نمو الحجم'
          : 'A flat bill against a per-shipment bill as volume grows'
      }
      meta={lang === 'ar' ? 'توضيحي، ليس بمقياس' : 'Illustrative, not to scale'}
      caption={
        lang === 'ar'
          ? 'الفاتورة لكل شحنة تبدأ من الصفر وتتجاوز الثابتة عند حجم معيّن. اطلبوا رقم التعادل مكتوباً من كل مورّد، بما فينا.'
          : 'A per-shipment bill starts at nothing and passes a flat one at some volume. Ask every vendor, us included, for that number in writing.'
      }
    >
      <CostShapeChart lang={lang} />
    </ChartFigure>
  )
}

/**
 * When a demurrage charge reaches the person who could still have stopped it.
 *
 * This one *is* a claim, and it is a claim about our own software: the clock
 * starts from the milestone that starts free time, so the charge line exists on
 * day one rather than arriving on a supplier invoice weeks later. The upper
 * row is what the reader already lives with, drawn without naming a system,
 * because "you find out on the invoice" describes a working method rather than
 * anybody's product.
 *
 * Built from Tailwind rather than a chart: there are two events on one time
 * scale and nothing to plot. Positions are logical (`inset-inline-start`), so in
 * Arabic the weeks run right to left with the page and nothing has to be
 * mirrored by hand. The six weeks are illustrative, and `meta` says so.
 */
const WEEKS = 6
const at = (week: number) => `${(week / WEEKS) * 100}%`

export function SurfaceTimeline({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const rows = [
    {
      key: 'late',
      name: ar ? 'بلا عدّاد' : 'Without a clock',
      note: ar ? 'يظهر على فاتورة مورّد' : 'Found on a supplier invoice',
      week: WEEKS,
    },
    {
      key: 'clock',
      name: ar ? 'مع العدّاد' : 'With the clock',
      note: ar ? 'بند تكلفة على الشحنة في اليوم الأول' : 'Charge line on the job, day one',
      week: 0,
    },
  ]

  return (
    <ChartFigure
      title={
        ar
          ? 'متى يصل رسم الأرضيات نفسه إلى من يستطيع التصرّف فيه'
          : 'When the same demurrage charge reaches someone who can act on it'
      }
      meta={ar ? 'توقيت توضيحي' : 'Illustrative timing'}
      caption={
        ar
          ? 'المبلغ نفسه في الصفّين. مع العدّاد يُكتب بنداً على الشحنة من اليوم الأول، وبدونه يصل على فاتورة مورّد بعد أسابيع.'
          : 'The amount is the same in both rows. With the clock it is a charge line on the job from day one; without it, a supplier invoice weeks later.'
      }
    >
      {/* The inline padding keeps the dots at week 0 and week 6 inside the
          card; every position below is measured inside it. */}
      <div className="px-2">
        <div className="relative">
          {/* Week gridlines, behind both rows and stopping at the axis. */}
          <div aria-hidden="true" className="absolute inset-x-0 top-0 bottom-0">
            {Array.from({ length: WEEKS + 1 }, (_, week) => (
              <span
                key={week}
                className="absolute top-0 bottom-0 w-px bg-line"
                style={{ insetInlineStart: at(week) }}
              />
            ))}
          </div>

          <div className="relative flex flex-col gap-7 py-1">
            {rows.map((row) => {
              const late = row.key === 'late'
              return (
                <div key={row.key} className="flex flex-col gap-2.5">
                  <p
                    className={`w-fit bg-paper-lift pe-2 text-small font-semibold ${
                      late ? 'text-heading' : 'text-blue-ink'
                    }`}
                  >
                    {row.name}
                  </p>
                  <div className="relative h-3.5">
                    {/* Navy and dashed while the charge runs unseen; solid blue
                        where it is a line on the job from the start. */}
                    <span
                      aria-hidden="true"
                      className={`absolute inset-x-0 top-1/2 -translate-y-1/2 ${
                        late ? 'border-t-2 border-dashed border-heading' : 'h-1 rounded-full bg-blue'
                      }`}
                    />
                    <span
                      aria-hidden="true"
                      className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-paper-lift rtl:translate-x-1/2 ${
                        late ? 'bg-heading' : 'bg-blue'
                      }`}
                      style={{ insetInlineStart: at(row.week) }}
                    />
                  </div>
                  {/* `self-end`, not `ms-auto`: inside a `.doc-page` scope the
                      stylesheet's `p { margin: 0 }` outranks a margin utility. */}
                  <p
                    className={`w-fit bg-paper-lift text-small text-ink-dim ${
                      late ? 'self-end ps-2 text-end' : 'pe-2'
                    }`}
                  >
                    {row.note}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* The shared scale. */}
        <div className="relative mt-3 h-7 border-t border-line-strong">
          {Array.from({ length: WEEKS + 1 }, (_, week) => (
            <span
              key={week}
              className="figures absolute top-1.5 -translate-x-1/2 text-label text-ink-dim rtl:translate-x-1/2"
              style={{ insetInlineStart: at(week) }}
            >
              {week}
            </span>
          ))}
        </div>
        <p className="mt-3 text-center text-label text-ink-dim">
          {ar ? 'الأسابيع منذ بدء تراكم الرسم' : 'Weeks since the charge started running'}
        </p>
      </div>
    </ChartFigure>
  )
}
