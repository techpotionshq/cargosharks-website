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
 * **They are drawn at the width they are displayed.** The first version used a
 * 420-unit viewBox capped at 640px, which left them rattling around in a
 * 1200px band and — worse — meant the SVG scaled by 2.6× when it did stretch,
 * taking every stroke and every label with it. A `viewBox` of 1000 across a
 * band that is about 1090px wide renders close to 1:1, so a 13px label is 13px
 * and a hairline is a hairline. The layout below is laid out in real pixels for
 * that reason: it is not arbitrary units, it is the drawing at its size.
 *
 * Both use the doc stylesheet's own variables, so they sit on `band--paper` and
 * `band--navy` without a second palette. See `.cmp-*` in `pages.css`, and the
 * `.band--navy` overrides beneath it — a figure that names its own greys can
 * only ever be right on one surface.
 */

/** The left gutter the track labels sit in, so nothing collides with a track. */
const GUTTER = 178
const TRACK_START = GUTTER + 22
const TRACK_END = 952

/**
 * How a bill grows, by the shape of the contract rather than by the vendor.
 *
 * Per-shipment and per-transaction pricing is normal in this category, it is
 * not a trick, and this figure does not say it is. What it says is that the two
 * shapes cross — a flat bill is worse at low volume and better at high — and
 * that the crossing is the number a buyer should ask every vendor to put in
 * writing. Neither line carries a name and neither axis carries a figure,
 * because the honest version of this chart has no scale on it: the shape is the
 * whole content.
 */
export function CostShape({ lang }: { lang: Lang }) {
  return (
    <figure className="cmp-figure">
      <div className="cmp-panel">
        <svg viewBox="0 0 1000 300" role="img" aria-labelledby="cost-shape-title" className="cmp-svg">
          <title id="cost-shape-title">
            {lang === 'ar'
              ? 'رسم يقارن شكل الفاتورة الثابتة بشكل الفاتورة لكل شحنة مع نمو الحجم'
              : 'A chart comparing the shape of a flat bill with a per-shipment bill as volume grows'}
          </title>

          {/* Two axes and nothing else. No gridlines: a grid invites a reader to
              read values off a chart that deliberately has none. */}
          <line x1="92" y1="26" x2="92" y2="238" className="cmp-axis" />
          <line x1="92" y1="238" x2="958" y2="238" className="cmp-axis" />

          {/* Per-shipment: starts near nothing and climbs with volume. */}
          <path d="M92 230 L 952 48" className="cmp-line cmp-line--per" fill="none" />
          {/* Flat: a floor you pay before the first shipment, then near level. */}
          <path d="M92 142 L 952 124" className="cmp-line cmp-line--flat" fill="none" />

          {/* The crossing — solved from the two lines above rather than eyeballed,
              which is why it is not a round number. */}
          <line x1="572" y1="132" x2="572" y2="238" className="cmp-guide" />
          <circle cx="572" cy="132" r="6" className="cmp-dot" />
          <text x="590" y="125" className="cmp-note">
            {lang === 'ar' ? 'نقطة التعادل — اسألوا عنها' : 'the crossing — ask for it'}
          </text>

          <text x="92" y="268" className="cmp-axis-label">
            {lang === 'ar' ? '← الحجم' : 'volume →'}
          </text>
          <text x="0" y="0" transform="translate(30,232) rotate(-90)" className="cmp-axis-label">
            {lang === 'ar' ? '← الفاتورة' : 'the bill →'}
          </text>

          <text x="700" y="42" className="cmp-key cmp-key--per">
            {lang === 'ar' ? 'لكل شحنة' : 'per shipment'}
          </text>
          <text x="700" y="116" className="cmp-key cmp-key--flat">
            {lang === 'ar' ? 'ثابتة' : 'flat'}
          </text>
        </svg>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'لا محور رأسي، وهذا مقصود: الشكل هو المحتوى كله. التسعير بالشحنة معتاد في هذا المجال وليس حيلة — لكنه شكل فاتورة مختلف، ونقطة التعادل هي الرقم الذي ينبغي أن تطلبوه مكتوباً من كل مورّد، بما فينا.'
          : 'There is no vertical scale, and that is deliberate — the shape is the whole content. Per-shipment pricing is normal in this category and is not a trick, but it is a different shape of bill, and the crossing point is the number worth asking every vendor to put in writing. Including us.'}
      </figcaption>
    </figure>
  )
}

/**
 * When a demurrage charge reaches the person who could still have stopped it.
 *
 * This one *is* a claim, and it is a claim about our own software: the clock
 * starts from the milestone that starts free time, so the charge line exists on
 * day one rather than arriving on a supplier invoice weeks later. The upper
 * track is what the reader already lives with, drawn without naming a system,
 * because "you find out on the invoice" describes a working method rather than
 * anybody's product.
 */
export function SurfaceTimeline({ lang }: { lang: Lang }) {
  const weeks = [0, 1, 2, 3, 4, 5, 6]
  const step = (TRACK_END - TRACK_START) / (weeks.length - 1)

  return (
    <figure className="cmp-figure">
      <div className="cmp-panel">
        <svg viewBox="0 0 1000 300" role="img" aria-labelledby="surface-title" className="cmp-svg">
          <title id="surface-title">
            {lang === 'ar'
              ? 'خط زمني يقارن ظهور رسم الأرضيات بعد ستة أسابيع بظهوره في اليوم الأول'
              : 'A timeline comparing a demurrage charge surfacing after six weeks with it surfacing on day one'}
          </title>

          {/* The week scale, shared by both tracks. The guides start below the
              first note row and stop above the week labels, so the grid never
              runs through a word. */}
          {weeks.map((week, index) => {
            const x = TRACK_START + index * step
            return (
              <g key={week}>
                <line x1={x} y1="66" x2={x} y2="238" className="cmp-guide" />
                <text x={x} y="268" textAnchor="middle" className="cmp-axis-label">
                  {week === 0 ? (lang === 'ar' ? 'اليوم ١' : 'day 1') : `w${week}`}
                </text>
              </g>
            )
          })}

          {/*
            Track labels live in a gutter to the left of the tracks.

            They were set beside the line at `x=0` while the track began at
            x=52, so "with the clock" printed straight through "charge line
            written". A reserved gutter cannot collide by construction, and it
            also lines the two labels up with each other, which reads as a
            comparison rather than as two captions.
          */}
          <text x="0" y="118" className="cmp-track-label">
            {lang === 'ar' ? 'بلا عدّاد' : 'no clock'}
          </text>
          <text x={TRACK_END} y="92" textAnchor="end" className="cmp-note cmp-note--late">
            {lang === 'ar' ? 'تظهر على فاتورة مورّد' : 'surfaces on a supplier invoice'}
          </text>
          <line
            x1={TRACK_START}
            y1="114"
            x2={TRACK_END}
            y2="114"
            className="cmp-track cmp-track--late"
          />
          <circle cx={TRACK_END} cy="114" r="7" className="cmp-mark cmp-mark--late" />

          <text x="0" y="216" className="cmp-track-label">
            {lang === 'ar' ? 'مع العدّاد' : 'with the clock'}
          </text>
          <text x={TRACK_START + 22} y="190" className="cmp-note">
            {lang === 'ar' ? 'يُكتب بند التكلفة فوراً' : 'charge line written at once'}
          </text>
          <line x1={TRACK_START} y1="212" x2={TRACK_END} y2="212" className="cmp-track" />
          <circle cx={TRACK_START} cy="212" r="7" className="cmp-mark" />
        </svg>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'الرقم نفسه في الحالتين. الفرق هو من يعرف به ومتى — وهل يصل بنداً كتبتموه أنتم على الشحنة التي سبّبته، أم مفاجأةً على فاتورة مورّد بعد ستة أسابيع.'
          : 'The same number in both cases. The difference is who knows about it and when — and whether it arrives as a charge line you raised against the job that caused it, or as a surprise on a supplier invoice six weeks later.'}
      </figcaption>
    </figure>
  )
}
