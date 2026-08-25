import type { ReactNode } from 'react'
import type { Bi, Lang } from '@/content/copy'

/**
 * The drawn figures on the document pages, and the rule every one of them is
 * drawn under.
 *
 * There were two, both on the comparison pages, both hairline line drawings,
 * and both about *categories of thing* rather than about anything the product
 * does — which is correct for where they sit and left every other page with
 * nothing to look at but prose and tables. Six thousand words of argument with
 * two diagrams in it reads as a specification, and the reader who most needs
 * `/what-we-do/` is the one least likely to finish it.
 *
 * So this file is the opposite kind of figure: **every drawing here is a
 * mechanism of our own software, and every number in it is computed rather
 * than written.** The chargeable weights are the three steps of
 * `packages/core/src/chargeable.ts` run on one pallet. The allocation is the
 * largest-remainder rule from `packages/core/src/allocation.ts`, done in front
 * of the reader down to the last fils. The duty matrix is
 * `packages/db/src/seed.ts`'s own `ROLE_PERMISSIONS`, transcribed. The charge
 * bases, the milestone templates and the currencies are seed rows.
 *
 * Two consequences follow, and both are the point:
 *
 *   1. **A figure here can go wrong, and it goes wrong loudly.** Change the air
 *      divisor and the bar moves. That is a stronger claim than any sentence on
 *      this site, because it is the sort of claim that can be falsified by
 *      opening a file.
 *   2. **None of them is about a competitor.** `/compare/` §03 forbids
 *      publishing claims about somebody else's product, and a chart is a claim
 *      with a shape. Nothing below carries a vendor's name, a price, or a
 *      number attributed to anyone but us.
 *
 * Every figure names the file its numbers came from, in mono, at the foot of
 * its own panel. That line is not decoration: it is the difference between a
 * chart and an assertion, and it is the same discipline as the `checked` date
 * on `comparisons.ts`.
 *
 * ## How they are drawn
 *
 * The SVG ones use a 1000-unit viewBox across a band about 1090px wide, so they
 * render close to 1:1 — a 13px label is 13px and a hairline is a hairline. That
 * is `comparison-figures.tsx`'s rule, and it is why the coordinates below are
 * round pixel numbers rather than arbitrary units.
 *
 * The rest are HTML — a matrix, a waffle, a proportional split, a row of chips.
 * Drawing a table in SVG to make it look like a chart would cost the text
 * selection, the reflow at 380px and the screen reader, and buy nothing: a
 * heatmap *is* a table with the values marked, and the honest way to build one
 * is to build the table.
 *
 * Colours come from the doc stylesheet's own variables through the `.fig-*` and
 * `.cmp-*` classes in `pages.css`, never from an attribute — a figure that
 * names its own greys can only ever be right on one surface, and half of these
 * sit on `band--navy`.
 */

/** Mono, small, and the same on every figure: where the numbers came from. */
function Source({ children }: { children: ReactNode }) {
  return <p className="fig-source">{children}</p>
}

/** The line above a drawing that says what is being measured. */
function Title({ lang, text }: { lang: Lang; text: Bi }) {
  return <p className="fig-title">{text[lang]}</p>
}

/* ═══════════════════════════════════════════════════════════════════════════
   01 — Chargeable weight: one pallet, five modes
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One pallet: 120 × 100 × 100 cm and 180 kg on the scale.
 *
 * A real pallet rather than a round one, because the whole argument of the
 * figure is that the number on the scale is not the number on the invoice, and
 * a tidy input hides that.
 */
const PALLET = { cbm: 1.2, grossKg: 180 }

/**
 * The five seeded rules, from `SEED_CHARGEABLE_RULES` in
 * `packages/core/src/chargeable.ts`.
 *
 * Re-typed rather than imported, and deliberately: `core` computes in
 * `Decimal`, and pulling decimal.js into a marketing bundle to hold five
 * divisors would be cargo-culting the money rule rather than keeping it.
 * Nothing here is priced, recorded or sent. What matters is that the arithmetic
 * below is the same three steps in the same order — greater of gross and
 * volumetric, round up to the increment, floor at the minimum — so the bars are
 * the engine's answer rather than an illustration of it.
 */
const RULES: {
  key: string
  label: Bi
  divisor: number | null
  roundUpToKg: number
  minimumKg: number
  unit: Bi
}[] = [
  {
    key: 'sea_lcl',
    label: { en: 'Sea LCL', ar: 'بحري مجمّع' },
    divisor: 1000,
    roundUpToKg: 0.001,
    minimumKg: 1000,
    unit: { en: 'revenue ton', ar: 'طن إيرادي' },
  },
  {
    key: 'land',
    label: { en: 'Land', ar: 'بري' },
    divisor: 3000,
    roundUpToKg: 1,
    minimumKg: 0,
    unit: { en: 'chargeable kg', ar: 'كجم خاضع' },
  },
  {
    key: 'courier',
    label: { en: 'Courier', ar: 'بريد سريع' },
    divisor: 5000,
    roundUpToKg: 0.5,
    minimumKg: 0.5,
    unit: { en: 'chargeable kg', ar: 'كجم خاضع' },
  },
  {
    key: 'air',
    label: { en: 'Air', ar: 'جوي' },
    divisor: 6000,
    roundUpToKg: 0.5,
    minimumKg: 45,
    unit: { en: 'chargeable kg', ar: 'كجم خاضع' },
  },
  {
    key: 'sea_fcl',
    label: { en: 'Sea FCL', ar: 'بحري بحاوية' },
    divisor: null,
    roundUpToKg: 1,
    minimumKg: 0,
    unit: { en: 'per container', ar: 'لكل حاوية' },
  },
]

const roundUpTo = (value: number, increment: number) =>
  increment <= 0 ? value : Math.ceil(value / increment) * increment

/** `chargeableWeight()` from core, on `PALLET`, in three steps and in order. */
function chargeableKg(rule: (typeof RULES)[number]): number | null {
  if (rule.divisor === null) return null
  const volumetric = (PALLET.cbm * 1_000_000) / rule.divisor
  const greater = Math.max(PALLET.grossKg, volumetric)
  return Math.max(rule.minimumKg, roundUpTo(greater, rule.roundUpToKg))
}

/**
 * The same box, billed five ways.
 *
 * This is the most useful single thing a forwarder can be shown about a pricing
 * engine, and it is the one a spreadsheet gets wrong quietly: 1.2 cbm is 200
 * chargeable kilos by air and 1,200 by sea LCL, a six-fold spread on a pallet
 * that never changed weight. The scale reads 180 kg and not one of the five
 * modes bills that number.
 */
export function ChargeableColumns({ lang }: { lang: Lang }) {
  const MAX = 1250
  const base = 270
  const top = 60

  const y = (kg: number) => base - (kg / MAX) * (base - top)
  const centres = [150, 330, 510, 690, 870]
  const width = 116

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: 'One pallet — 120 × 100 × 100 cm, 180 kg on the scale',
            ar: 'منصة واحدة — 120 × 100 × 100 سم، 180 كجم على الميزان',
          }}
        />

        <svg
          viewBox="0 0 1000 360"
          role="img"
          aria-labelledby="chargeable-title"
          className="cmp-svg"
        >
          <title id="chargeable-title">
            {lang === 'ar'
              ? 'أعمدة تبيّن الوزن الخاضع للتسعير للمنصة نفسها في خمس وسائل شحن'
              : 'A column chart showing the chargeable weight of the same pallet in five transport modes'}
          </title>

          {/* Four stops, not a grid. A grid invites reading values off the chart
              to the kilo, and the values are printed on the bars instead. */}
          {[0, 400, 800, 1200].map((tick) => (
            <g key={tick}>
              <line x1="84" y1={y(tick)} x2="960" y2={y(tick)} className="fig-grid" />
              <text x="72" y={y(tick) + 4} textAnchor="end" className="cmp-axis-label">
                {tick}
              </text>
            </g>
          ))}

          {/* What the scale says. Every bar that clears it is the difference
              between weighing a shipment and billing one. */}
          <line
            x1="84"
            y1={y(PALLET.grossKg)}
            x2="960"
            y2={y(PALLET.grossKg)}
            className="fig-rule"
          />
          <text x="960" y={y(PALLET.grossKg) - 12} textAnchor="end" className="cmp-note">
            {lang === 'ar' ? '180 كجم — ما يقوله الميزان' : '180 kg — what the scale says'}
          </text>

          {RULES.map((rule, index) => {
            const centre = centres[index]!
            const kg = chargeableKg(rule)

            return (
              <g key={rule.key}>
                {kg === null ? (
                  <>
                    {/* FCL has no bar because it has no volumetric step: volume
                        never enters the calculation, and a bar of height zero
                        would read as "cheapest" rather than "not this
                        arithmetic". */}
                    <rect
                      x={centre - width / 2}
                      y={base - 74}
                      width={width}
                      height="74"
                      className="fig-bar--ghost"
                    />
                    <text x={centre} y={base - 88} textAnchor="middle" className="cmp-axis-label">
                      {lang === 'ar' ? 'بلا وزن حجمي' : 'no volumetric step'}
                    </text>
                  </>
                ) : (
                  <>
                    <rect
                      x={centre - width / 2}
                      y={y(kg)}
                      width={width}
                      height={base - y(kg)}
                      className={index === 0 ? 'fig-bar fig-bar--lead' : 'fig-bar'}
                    />
                    <text x={centre} y={y(kg) - 14} textAnchor="middle" className="fig-value">
                      {kg.toLocaleString('en')} kg
                    </text>
                  </>
                )}

                <text x={centre} y={base + 30} textAnchor="middle" className="cmp-track-label">
                  {rule.label[lang]}
                </text>
                <text x={centre} y={base + 52} textAnchor="middle" className="cmp-axis-label">
                  {rule.divisor === null
                    ? rule.unit[lang]
                    : `${rule.divisor.toLocaleString('en')} cm³/kg`}
                </text>
                {rule.divisor === null ? null : (
                  <text x={centre} y={base + 72} textAnchor="middle" className="cmp-axis-label">
                    {lang === 'ar'
                      ? `الحد الأدنى ${rule.minimumKg.toLocaleString('en')} كجم`
                      : `min ${rule.minimumKg.toLocaleString('en')} kg`}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        <Source>packages/core/src/chargeable.ts · SEED_CHARGEABLE_RULES</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'الطرد نفسه والوزن نفسه، وخمسة أرقام مختلفة على الفاتورة: 200 كجم جواً مقابل 1,200 كجم بحراً مجمّعاً — ستة أضعاف على منصة لم يتغيّر وزنها. والقواسم صفوف بيانات لا ثوابت في الشيفرة: ناقلٌ ينتقل من القاسم 6000 إلى 5000 تعديلٌ يجريه المسؤول لا إصدارٌ برمجي.'
          : 'Same pallet, same weight, five different numbers on the invoice: 200 kg by air against 1,200 by sea LCL — a six-fold spread on a box whose weight never changed. The divisors are seed rows rather than constants: an airline moving from a 6,000 divisor to a 5,000 one is an administrator’s edit, not a release (FR-AD-03).'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   02 — Demurrage: the stair a clock climbs on its own
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The demo's own clock: five free days, KWD 28.000 a day after them.
 *
 * `packages/db/src/seed-demo.ts` seeds exactly this — `{ freeDays: 5,
 * startedDaysAgo: 9, perDiem: '28.000' }` — so the figure is a dataset the
 * reader can open rather than a plausible tariff written for a website. Where a
 * carrier's line escalates instead of running flat, that is a `PerDiemTier` row
 * in `clocks.ts` and not a different calculation, which is why the stair is
 * drawn with one slope and the caption says so.
 */
const CLOCK = { freeDays: 5, perDiem: 28, days: 21 }

export function AccrualStair({ lang }: { lang: Lang }) {
  const MAX = 480
  const base = 260
  const top = 50
  const x = (day: number) => 90 + (day / CLOCK.days) * 870
  const y = (kwd: number) => base - (kwd / MAX) * (base - top)

  /**
   * A stair rather than a line, because the money arrives in whole days.
   *
   * A slope would say the charge accrues by the hour, which is what a per-hour
   * rate does and is not what a per diem is. The vertical is the midnight the
   * day ticks over on; the horizontal is the day itself.
   */
  let stair = `M ${x(0)} ${y(0)} L ${x(CLOCK.freeDays)} ${y(0)}`
  for (let day = CLOCK.freeDays + 1; day <= CLOCK.days; day++) {
    const total = (day - CLOCK.freeDays) * CLOCK.perDiem
    stair += ` L ${x(day).toFixed(1)} ${y(total - CLOCK.perDiem).toFixed(1)}`
    stair += ` L ${x(day).toFixed(1)} ${y(total).toFixed(1)}`
  }
  const area = `${stair} L ${x(CLOCK.days).toFixed(1)} ${y(0)} Z`
  const final = (CLOCK.days - CLOCK.freeDays) * CLOCK.perDiem

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: 'One container: five free days, then KWD 28.000 a day',
            ar: 'حاوية واحدة: خمسة أيام سماح، ثم 28.000 د.ك في اليوم',
          }}
        />

        <svg viewBox="0 0 1000 330" role="img" aria-labelledby="accrual-title" className="cmp-svg">
          <title id="accrual-title">
            {lang === 'ar'
              ? 'رسم درجي يبيّن تراكم رسم الأرضيات يوماً بيوم بعد انتهاء وقت السماح'
              : 'A step chart showing demurrage accruing day by day once free time ends'}
          </title>

          {[0, 120, 240, 360, 480].map((tick) => (
            <g key={tick}>
              <line x1="84" y1={y(tick)} x2="960" y2={y(tick)} className="fig-grid" />
              <text x="72" y={y(tick) + 4} textAnchor="end" className="cmp-axis-label">
                {tick}
              </text>
            </g>
          ))}

          {/* Free time as a region rather than a label. It is the part everybody
              plans for and nobody is billed for, so it should read as ground
              rather than as value. */}
          <rect
            x={x(0)}
            y={top}
            width={x(CLOCK.freeDays) - x(0)}
            height={base - top}
            className="fig-free"
          />
          <text
            x={(x(0) + x(CLOCK.freeDays)) / 2}
            y={top + 24}
            textAnchor="middle"
            className="cmp-axis-label"
          >
            {lang === 'ar' ? 'وقت السماح' : 'free time'}
          </text>

          <path d={area} className="fig-area" />
          <path d={stair} className="fig-step" fill="none" />

          {/* The first chargeable day, which is the whole argument: the line is
              written on the day it is incurred, against the job that caused it. */}
          <circle cx={x(CLOCK.freeDays + 1)} cy={y(CLOCK.perDiem)} r="6" className="cmp-dot" />
          <text x={x(CLOCK.freeDays + 1) + 16} y={y(CLOCK.perDiem) - 14} className="cmp-note">
            {lang === 'ar' ? 'أول بند تكلفة · 28.000 د.ك' : 'first charge line · KWD 28.000'}
          </text>

          <circle cx={x(CLOCK.days)} cy={y(final)} r="6" className="cmp-dot" />
          <text x={x(CLOCK.days)} y={y(final) - 18} textAnchor="end" className="cmp-note">
            {lang === 'ar' ? `${final}.000 د.ك` : `KWD ${final}.000`}
          </text>

          <line x1="84" y1={base} x2="960" y2={base} className="cmp-axis" />
          {[0, 3, 6, 9, 12, 15, 18, 21].map((day) => (
            <text key={day} x={x(day)} y={base + 26} textAnchor="middle" className="cmp-axis-label">
              {day === 0 ? (lang === 'ar' ? 'اليوم 0' : 'day 0') : day}
            </text>
          ))}
          <text x="90" y={base + 54} className="cmp-axis-label">
            {lang === 'ar' ? 'الأيام منذ التفريغ' : 'days since discharge'}
          </text>
          <text x="0" y="0" transform="translate(28,152) rotate(-90)" className="cmp-axis-label">
            KWD
          </text>
        </svg>

        <Source>packages/core/src/clocks.ts · packages/db/src/seed-demo.ts</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'العدّاد يشغّله وصول المرحلة، لا تذكُّر أحدهم. الأيام الخمسة الأولى مجانية لأن الناقل قال ذلك؛ وفي اليوم السادس يُكتب بند تكلفة على الشحنة نفسها بالمبلغ الذي سيظهر لاحقاً على فاتورة المورّد. وحين تكون تعرفة الناقل تصاعدية فتلك صفوف شرائح في المحرّك نفسه لا حسابٌ آخر. هذه أرقام البيانات المُعدّة في النسخة التجريبية.'
          : 'The counter is started by a milestone arriving, not by somebody remembering. The first five days are free because the carrier said so; on the sixth a charge line is written against the job itself, for the amount that will later appear on a supplier invoice. Where a carrier’s tariff escalates rather than running flat, that is a row of per-diem tiers in the same engine and not a different calculation. These are the demo’s own seeded figures.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   03 — Allocation: where the last fils goes
   ═══════════════════════════════════════════════════════════════════════════ */

/** Three houses under one master, with the CBM each of them brought. */
const HOUSES: { ref: string; cbm: number }[] = [
  { ref: 'HBL-2211', cbm: 12.5 },
  { ref: 'HBL-2212', cbm: 7.25 },
  { ref: 'HBL-2213', cbm: 4.75 },
]
const MASTER_COST = 100

/**
 * The largest-remainder method, done in front of the reader.
 *
 * `packages/core/src/allocation.ts` is insistent about this and is right to be:
 * exact proportional shares almost never land on whole fils, so a split either
 * loses money, invents it, or hands the remainder out by a rule. The rule is
 * floor every share, then give the leftover units one at a time to the largest
 * fractional remainders — the same arithmetic parliaments use to turn vote
 * shares into seats.
 *
 * It is computed here rather than typed, which is the point of putting it on a
 * marketing page at all: a reader can add the last column up.
 */
function allocate() {
  const totalCbm = HOUSES.reduce((sum, house) => sum + house.cbm, 0)

  const rows = HOUSES.map((house) => {
    const exact = (MASTER_COST * house.cbm) / totalCbm
    const floored = Math.floor(exact * 1000) / 1000
    return { ...house, exact, floored, remainder: exact - floored, extraFils: 0 }
  })

  // Whole fils still unallocated once every share has been floored.
  let left = Math.round((MASTER_COST - rows.reduce((sum, row) => sum + row.floored, 0)) * 1000)

  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder)) {
    if (left <= 0) break
    row.extraFils = 1
    left -= 1
  }

  return rows.map((row) => ({ ...row, final: row.floored + row.extraFils / 1000 }))
}

export function AllocationSplit({ lang }: { lang: Lang }) {
  const rows = allocate()
  const totalCbm = HOUSES.reduce((sum, house) => sum + house.cbm, 0)
  const settled = rows.reduce((sum, row) => sum + row.final, 0)
  const floors = rows.reduce((sum, row) => sum + row.floored, 0)
  const spare = rows.reduce((sum, row) => sum + row.extraFils, 0)

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: 'KWD 100.000 of master cost, across three houses, by volume',
            ar: '100.000 د.ك تكلفة رئيسية على ثلاث بوالص فرعية، حسب الحجم',
          }}
        />

        {/*
          The split at its real proportions.

          `flexGrow` takes the CBM itself rather than a percentage width: the
          bar *is* the drivers, and a rounded percentage in the markup would be
          a second arithmetic quietly disagreeing with the table underneath it.
        */}
        <div
          className="fig-split"
          role="img"
          aria-label={
            lang === 'ar'
              ? 'شريط يبيّن حصة كل بوليصة فرعية من التكلفة الرئيسية حسب حجمها'
              : 'A bar showing each house bill’s share of the master cost by its volume'
          }
        >
          {rows.map((row, index) => (
            <div
              key={row.ref}
              className={`fig-split__seg fig-split__seg--${index + 1}`}
              style={{ flexGrow: row.cbm }}
            >
              <b>{row.ref}</b>
              <span>{row.cbm} cbm</span>
            </div>
          ))}
        </div>

        <div className="tablewrap fig-tablewrap">
          <table className="fig-table">
            <thead>
              <tr>
                <th scope="col">{lang === 'ar' ? 'البوليصة' : 'House'}</th>
                <th scope="col">{lang === 'ar' ? 'المُحرِّك' : 'Driver'}</th>
                <th scope="col">{lang === 'ar' ? 'الحصة الدقيقة' : 'Exact share'}</th>
                <th scope="col">{lang === 'ar' ? 'بعد الحطّ' : 'Floored'}</th>
                <th scope="col">{lang === 'ar' ? 'الفلس المتبقّي' : 'Left-over fils'}</th>
                <th scope="col">{lang === 'ar' ? 'المرحَّل' : 'Posted'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ref}>
                  <th scope="row">{row.ref}</th>
                  <td>
                    {row.cbm} / {totalCbm}
                  </td>
                  <td className="fig-num fig-num--soft">{row.exact.toFixed(6)}</td>
                  <td className="fig-num">{row.floored.toFixed(3)}</td>
                  <td className="fig-num">{row.extraFils ? '+0.001' : '—'}</td>
                  <td className="fig-num fig-num--strong">{row.final.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{lang === 'ar' ? 'المجموع' : 'Total'}</th>
                <td>{totalCbm}</td>
                <td className="fig-num fig-num--soft">{MASTER_COST.toFixed(6)}</td>
                <td className="fig-num">{floors.toFixed(3)}</td>
                <td className="fig-num">+{(spare / 1000).toFixed(3)}</td>
                <td className="fig-num fig-num--strong">{settled.toFixed(3)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <Source>packages/core/src/allocation.ts · largest-remainder</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'الحصص الدقيقة لا تقع على فلوس صحيحة تقريباً أبداً، فيبقى فلسان بعد حطّ كل حصة. إسقاطهما يضيّع مالاً ومنحهما للجميع يخلق مالاً، فيذهبان إلى أكبر كسرَين متبقّيين — وهي القاعدة نفسها التي تحوّل بها البرلمانات الأصوات إلى مقاعد. العمود الأخير يجمع 100.000 بالضبط، وهذا ما يجعل هامش البوليصة الحادية عشرة رقماً يمكن الدفاع عنه بعد ستة أشهر.'
          : 'Exact shares almost never land on whole fils, so two are left over once every share is floored. Dropping them loses money and spreading them creates it, so they go to the two largest fractional remainders — the same rule parliaments use to turn votes into seats. The last column sums to 100.000 exactly, which is what makes the margin on house eleven a number you can still defend six months later.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   04 — Separation of duties, as a matrix
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `ROLE_PERMISSIONS` from `packages/db/src/seed.ts`, for six keys that decide
 * whether an auditor is satisfied.
 *
 * Transcribed, not summarised. Every cell below can be checked by opening that
 * file and reading the list under the role — which is the only reason a matrix
 * like this is worth publishing at all, because the version of it a vendor
 * writes from memory is always the flattering one.
 *
 * `administrator` is not in the seed's matrix and holds every row here for the
 * reason the seed gives: it receives `allPermissionKeys()`, including keys
 * added later, so a new transition cannot ship unreachable. Saying so in a
 * footnote is more honest than a row of ticks with no explanation.
 */
const DUTY_ACTIONS: { key: string; label: Bi }[] = [
  { key: 'invoice.issue', label: { en: 'Issue an invoice', ar: 'إصدار فاتورة' } },
  { key: 'invoice.credit', label: { en: 'Credit one', ar: 'إشعار دائن' } },
  { key: 'payable.approve', label: { en: 'Approve a supplier bill', ar: 'اعتماد فاتورة مورّد' } },
  { key: 'consol.allocate', label: { en: 'Split a master cost', ar: 'توزيع تكلفة رئيسية' } },
  { key: 'job.book', label: { en: 'Book a job', ar: 'فتح شحنة' } },
  { key: 'job.close', label: { en: 'Close one', ar: 'إقفال شحنة' } },
]

const DUTY_ROLES: { key: string; label: Bi; holds: string[] }[] = [
  {
    key: 'administrator',
    label: { en: 'Administrator', ar: 'مسؤول النظام' },
    holds: DUTY_ACTIONS.map((action) => action.key),
  },
  {
    key: 'finance',
    label: { en: 'Finance', ar: 'المالية' },
    holds: ['invoice.issue', 'invoice.credit', 'payable.approve', 'consol.allocate'],
  },
  {
    key: 'operations_manager',
    label: { en: 'Operations Manager', ar: 'مدير العمليات' },
    holds: ['consol.allocate', 'job.book', 'job.close'],
  },
  {
    key: 'coordinator',
    label: { en: 'Coordinator', ar: 'منسق' },
    holds: ['job.book'],
  },
  { key: 'sales', label: { en: 'Sales', ar: 'المبيعات' }, holds: [] },
  { key: 'customs_broker', label: { en: 'Customs Broker', ar: 'مخلص جمركي' }, holds: [] },
  { key: 'read_only', label: { en: 'Read Only', ar: 'اطلاع فقط' }, holds: [] },
]

export function DutyMatrix({ lang }: { lang: Lang }) {
  const yes = lang === 'ar' ? 'مسموح' : 'granted'
  const no = lang === 'ar' ? 'غير مسموح' : 'not granted'

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: 'Seven seeded roles, six keys an auditor asks about',
            ar: 'سبعة أدوار مُعدّة مسبقاً، وستة مفاتيح يسأل عنها المدقق',
          }}
        />

        <div className="tablewrap fig-tablewrap">
          <table className="fig-matrix">
            <thead>
              <tr>
                <th scope="col">{lang === 'ar' ? 'الدور' : 'Role'}</th>
                {DUTY_ACTIONS.map((action) => (
                  <th key={action.key} scope="col">
                    {action.label[lang]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DUTY_ROLES.map((role) => (
                <tr key={role.key}>
                  <th scope="row">{role.label[lang]}</th>
                  {DUTY_ACTIONS.map((action) => {
                    const held = role.holds.includes(action.key)
                    return (
                      <td key={action.key} className={held ? 'is-on' : 'is-off'}>
                        <span aria-hidden="true" />
                        <span className="visually-hidden">{held ? yes : no}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Source>packages/db/src/seed.ts · ROLE_PERMISSIONS</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'الصفّان الفارغان ليسا سهواً: المبيعات تسعّر وتغلق الاستفسارات ولا تصدر فاتورة قط، والمخلّص الجمركي يقدّم البيانات ولا يفتح شحنة. مدير العمليات لا يصدر الفواتير ولا يعتمد فواتير المورّدين — وهذا هو الفصل الذي يسأل عنه المدقق أولاً. أما مسؤول النظام فيحمل كل مفتاح بحكم التصميم، بما فيها ما يُضاف لاحقاً، حتى لا تُشحن عملية جديدة بلا من يبلغها.'
          : 'The two empty rows are not an oversight: Sales prices and closes enquiries and never issues an invoice, and a Customs Broker files declarations and never books a job. The Operations Manager issues nothing and approves no supplier bill — which is the separation an auditor asks about first. Administrator holds every key by design, including keys added later, so that a new transition cannot ship unreachable.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   05 — Milestone templates, as six dot strips
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The six seeded templates from `MILESTONES` in `packages/db/src/seed.ts`, with
 * the names from `MILESTONE_NAMES` beside them in both languages.
 *
 * The point of drawing them together is the thing a feature list cannot say: a
 * sea import is nine steps and a land import is five, so a single "shipment
 * checklist" is either too long for the road or too short for the water. They
 * do not share a checklist here because they do not share one in the yard.
 */
const MILESTONE_NAMES: Record<string, Bi> = {
  booking_confirmed: { en: 'Booking confirmed', ar: 'تأكيد الحجز' },
  cargo_received: { en: 'Cargo received', ar: 'استلام البضاعة' },
  empty_picked_up: { en: 'Empty container collected', ar: 'استلام الحاوية الفارغة' },
  stuffed: { en: 'Container stuffed', ar: 'تعبئة الحاوية' },
  gate_in: { en: 'Gate in', ar: 'دخول الميناء' },
  loaded: { en: 'Loaded', ar: 'التحميل' },
  vessel_departed: { en: 'Vessel departed', ar: 'مغادرة السفينة' },
  vessel_arrived: { en: 'Vessel arrived', ar: 'وصول السفينة' },
  discharged: { en: 'Discharged', ar: 'التفريغ' },
  devanned: { en: 'Devanned', ar: 'تفريغ الحاوية' },
  customs_cleared: { en: 'Customs cleared', ar: 'التخليص الجمركي' },
  gate_out: { en: 'Gate out', ar: 'الخروج من الميناء' },
  border_crossed: { en: 'Border crossed', ar: 'عبور الحدود' },
  flight_departed: { en: 'Flight departed', ar: 'مغادرة الرحلة' },
  flight_arrived: { en: 'Flight arrived', ar: 'وصول الرحلة' },
  delivered: { en: 'Delivered', ar: 'التسليم' },
  empty_returned: { en: 'Empty returned', ar: 'إعادة الحاوية الفارغة' },
}

const TEMPLATES: { flow: Bi; steps: string[] }[] = [
  {
    flow: { en: 'Sea FCL · import', ar: 'بحري بحاوية · استيراد' },
    steps: [
      'booking_confirmed',
      'cargo_received',
      'vessel_departed',
      'vessel_arrived',
      'discharged',
      'customs_cleared',
      'gate_out',
      'delivered',
      'empty_returned',
    ],
  },
  {
    flow: { en: 'Sea FCL · export', ar: 'بحري بحاوية · تصدير' },
    steps: [
      'booking_confirmed',
      'empty_picked_up',
      'stuffed',
      'gate_in',
      'customs_cleared',
      'loaded',
      'vessel_departed',
      'vessel_arrived',
      'delivered',
    ],
  },
  {
    flow: { en: 'Sea LCL · import', ar: 'بحري مجمّع · استيراد' },
    steps: [
      'booking_confirmed',
      'cargo_received',
      'vessel_departed',
      'vessel_arrived',
      'discharged',
      'devanned',
      'customs_cleared',
      'delivered',
    ],
  },
  {
    flow: { en: 'Air · import', ar: 'جوي · استيراد' },
    steps: [
      'booking_confirmed',
      'cargo_received',
      'flight_departed',
      'flight_arrived',
      'customs_cleared',
      'delivered',
    ],
  },
  {
    flow: { en: 'Air · export', ar: 'جوي · تصدير' },
    steps: [
      'booking_confirmed',
      'cargo_received',
      'customs_cleared',
      'flight_departed',
      'flight_arrived',
      'delivered',
    ],
  },
  {
    flow: { en: 'Land · import', ar: 'بري · استيراد' },
    steps: ['booking_confirmed', 'loaded', 'border_crossed', 'customs_cleared', 'delivered'],
  },
]

export function MilestoneStrips({ lang }: { lang: Lang }) {
  const gutter = 210
  const trackStart = gutter + 24
  const trackEnd = 890
  const rowHeight = 44
  const firstRow = 54
  const longest = Math.max(...TEMPLATES.map((template) => template.steps.length))

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: 'Six seeded milestone templates, at their real lengths',
            ar: 'ستة قوالب مراحل مُعدّة مسبقاً، بأطوالها الحقيقية',
          }}
        />

        <svg
          viewBox={`0 0 1000 ${firstRow + TEMPLATES.length * rowHeight + 34}`}
          role="img"
          aria-labelledby="milestones-title"
          className="cmp-svg"
        >
          <title id="milestones-title">
            {lang === 'ar'
              ? 'ستة صفوف من النقاط، كل صف قالب مراحل لوسيلة واتجاه، وطول الصف عدد مراحله'
              : 'Six rows of dots, each a milestone template for one mode and direction, the length of the row being its number of steps'}
          </title>

          {TEMPLATES.map((template, row) => {
            const y = firstRow + row * rowHeight
            // Every row is spaced on the *longest* template rather than on its
            // own length, so a short flow is visibly short. Normalising each row
            // to the full width would draw six identical strips and say nothing.
            const step = (trackEnd - trackStart) / (longest - 1)
            const end = trackStart + (template.steps.length - 1) * step

            return (
              <g key={template.flow.en}>
                <text x="0" y={y + 5} className="cmp-track-label">
                  {template.flow[lang]}
                </text>
                <line x1={trackStart} y1={y} x2={end} y2={y} className="fig-strip" />
                {template.steps.map((name, index) => (
                  <circle
                    key={name + index}
                    cx={trackStart + index * step}
                    cy={y}
                    r={index === 0 || index === template.steps.length - 1 ? 6 : 4}
                    className={
                      index === 0 || index === template.steps.length - 1
                        ? 'cmp-mark'
                        : 'fig-strip__dot'
                    }
                  >
                    {/* The name is on the dot rather than under it: seventeen
                        labels across six rows is a wall of type, and the
                        information a reader wants from this drawing is the
                        shape. */}
                    <title>{MILESTONE_NAMES[name]?.[lang] ?? name}</title>
                  </circle>
                ))}
                <text x="920" y={y + 5} className="fig-value fig-value--sm">
                  {template.steps.length}
                </text>
              </g>
            )
          })}

          <text x={trackStart} y={firstRow - 26} className="cmp-axis-label">
            {lang === 'ar' ? 'تأكيد الحجز' : 'booking confirmed'}
          </text>
          <text x="920" y={firstRow - 26} textAnchor="end" className="cmp-axis-label">
            {lang === 'ar' ? 'مراحل' : 'steps'}
          </text>
        </svg>

        <Source>packages/db/src/seed.ts · MILESTONES</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'كل قالب يبدأ بتأكيد الحجز وينتهي بالتسليم — عدا الاستيراد بحاوية كاملة، الذي ينتهي بإعادة الحاوية الفارغة، وهي المرحلة التي يقف عندها عدّاد التأخير. تسعة صفوف للبحري وخمسة للبري، ولذلك لا «قائمة تحقّق للشحنة» واحدة: ستكون إمّا أطول من اللازم على الطريق أو أقصر من اللازم على الماء. مرّروا المؤشّر على أي نقطة لاسمها.'
          : 'Every template opens at booking confirmed and ends at delivered — except the FCL import, which ends at empty returned, the milestone the detention clock stops on. Nine steps by sea and five by road, which is why there is no single “shipment checklist”: it would be too long for the road or too short for the water. Hover any dot for its name.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   06 — The charge catalogue, as a waffle
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `CHARGE_TYPES` from `packages/db/src/seed.ts`, grouped by the rating basis
 * each row names.
 *
 * Twenty-one rows over six functions. The figure exists to make one sentence
 * concrete — *configuration is rows, not code* (FR-AD-03) — because it is the
 * claim on this site that sounds most like marketing and is easiest to check:
 * a new accessorial is a row naming one of these six bases, and nobody ships a
 * release for it.
 */
const CHARGE_BASES: { key: string; label: Bi; charges: Bi[] }[] = [
  {
    key: 'per_container',
    label: { en: 'per container', ar: 'لكل حاوية' },
    charges: [
      { en: 'Ocean Freight', ar: 'أجرة الشحن البحري' },
      { en: 'Terminal Handling — Origin', ar: 'مناولة المحطة — المنشأ' },
      { en: 'Terminal Handling — Destination', ar: 'مناولة المحطة — الوجهة' },
      { en: 'Haulage', ar: 'النقل الداخلي' },
      { en: 'Out of Gauge', ar: 'شحنات غير قياسية' },
    ],
  },
  {
    key: 'flat',
    label: { en: 'flat', ar: 'مبلغ مقطوع' },
    charges: [
      { en: 'Road Freight', ar: 'أجرة النقل البري' },
      { en: 'Documentation', ar: 'رسوم المستندات' },
      { en: 'Customs Clearance', ar: 'التخليص الجمركي' },
      { en: 'Delivery Order', ar: 'إذن التسليم' },
      { en: 'Inspection', ar: 'الفحص' },
      { en: 'Permit', ar: 'التصاريح' },
    ],
  },
  {
    key: 'per_day',
    label: { en: 'per day', ar: 'لكل يوم' },
    charges: [
      { en: 'Reefer Monitoring', ar: 'مراقبة التبريد' },
      { en: 'Demurrage', ar: 'أرضيات' },
      { en: 'Detention', ar: 'رسوم التأخير' },
      { en: 'Storage', ar: 'رسوم التخزين' },
    ],
  },
  {
    key: 'per_kg',
    label: { en: 'per kg', ar: 'لكل كجم' },
    charges: [
      { en: 'Air Freight', ar: 'أجرة الشحن الجوي' },
      { en: 'Security Surcharge', ar: 'رسوم الأمن' },
    ],
  },
  {
    key: 'percent',
    label: { en: 'percent', ar: 'نسبة مئوية' },
    charges: [
      { en: 'Fuel Surcharge', ar: 'رسوم الوقود' },
      { en: 'Cargo Insurance', ar: 'تأمين البضائع' },
    ],
  },
  {
    key: 'per_unit',
    label: { en: 'per unit', ar: 'لكل وحدة' },
    charges: [
      { en: 'Dangerous Goods', ar: 'البضائع الخطرة' },
      { en: 'Legalisation', ar: 'التصديق' },
    ],
  },
]

export function ChargeWaffle({ lang }: { lang: Lang }) {
  const total = CHARGE_BASES.reduce((sum, basis) => sum + basis.charges.length, 0)

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: `${total} seeded charge types, over six rating functions`,
            ar: `${total} نوع تكلفة مُعدّاً مسبقاً، على ست دوال تسعير`,
          }}
        />

        <div className="fig-waffle">
          {CHARGE_BASES.map((basis) => (
            <div key={basis.key} className="fig-waffle__group">
              <p className="fig-waffle__label">
                {basis.label[lang]}
                <b>{basis.charges.length}</b>
              </p>
              <ul className="fig-waffle__cells">
                {basis.charges.map((charge) => (
                  <li key={charge.en} className="fig-waffle__cell" title={charge[lang]}>
                    <span className="visually-hidden">{charge[lang]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Source>packages/db/src/seed.ts · CHARGE_TYPES · packages/core/src/rating.ts</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'كل مربّع نوع تكلفة، وكل مجموعة الدالة التي يُحسب بها — مرّروا المؤشّر لاسمه. الرسم كله عن جملة واحدة: الإعداد صفوف لا شيفرة. رسم إضافي جديد صفٌّ يسمّي إحدى هذه الدوال الست، يضيفه المسؤول، ولا إصدار برمجي له.'
          : 'Each square is a charge type and each group the function it is computed by — hover one for its name. The whole drawing is about a single sentence: configuration is rows, not code. A new accessorial is a row naming one of these six functions, added by an administrator, with no release behind it.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   07 — Three decimals, and the currencies that need them
   ═══════════════════════════════════════════════════════════════════════════ */

/** `CURRENCIES` from `packages/db/src/seed.ts`, with their minor units. */
const CURRENCIES: { code: string; minor: number }[] = [
  { code: 'KWD', minor: 3 },
  { code: 'BHD', minor: 3 },
  { code: 'OMR', minor: 3 },
  { code: 'USD', minor: 2 },
  { code: 'EUR', minor: 2 },
  { code: 'GBP', minor: 2 },
  { code: 'AED', minor: 2 },
  { code: 'QAR', minor: 2 },
  { code: 'SAR', minor: 2 },
  { code: 'INR', minor: 2 },
  { code: 'CNY', minor: 2 },
]

/**
 * The fils column, drawn at the size of the argument.
 *
 * Three of the eleven seeded currencies carry three decimal places, and all
 * three of them are Gulf currencies — which is why a system built for dollars
 * and adapted afterwards is wrong here in a way that never shows up in its home
 * market. `CLAUDE.md` puts it in one line: a global `toFixed(2)` corrupts every
 * Kuwaiti amount. This is that line as a picture.
 */
export function MinorUnits({ lang }: { lang: Lang }) {
  const three = CURRENCIES.filter((currency) => currency.minor === 3)

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: `${three.length} of ${CURRENCIES.length} seeded currencies carry three decimals`,
            ar: `${three.length} من ${CURRENCIES.length} عملات مُعدّة مسبقاً بثلاث خانات عشرية`,
          }}
        />

        <ul className="fig-chips">
          {CURRENCIES.map((currency) => (
            <li
              key={currency.code}
              className={currency.minor === 3 ? 'fig-chip fig-chip--three' : 'fig-chip'}
            >
              <b>{currency.code}</b>
              <span>
                {currency.minor}
                {lang === 'ar' ? ' خانة' : ' dp'}
              </span>
            </li>
          ))}
        </ul>

        <div className="fig-place">
          <div className="fig-place__side">
            <p className="fig-place__label">
              {lang === 'ar' ? 'ما يخزّنه هذا النظام' : 'What this system stores'}
            </p>
            <p className="fig-place__amount">
              <span className="fig-place__cur">KWD</span> 12.34
              <b>5</b>
            </p>
            <p className="fig-place__note">
              {lang === 'ar'
                ? 'numeric(19,6) في القاعدة، Decimal في المحرّكات، نصٌّ على الشبكة'
                : 'numeric(19,6) in the database, Decimal in the engines, a string on the wire'}
            </p>
          </div>
          <div className="fig-place__side fig-place__side--lost">
            <p className="fig-place__label">
              {lang === 'ar'
                ? 'ما يخزّنه نظامٌ بُني للدولار'
                : 'What a system built for dollars stores'}
            </p>
            <p className="fig-place__amount">
              <span className="fig-place__cur">KWD</span> 12.35
              <b className="fig-place__gone">—</b>
            </p>
            <p className="fig-place__note">
              {lang === 'ar'
                ? 'الفلس ليس خطأ تقريب، بل عملة متداولة: خمسة فلوس على كل بند'
                : 'The fils is not a rounding error, it is money in circulation: five of them on every line'}
            </p>
          </div>
        </div>

        <Source>packages/db/src/seed.ts · CURRENCIES · packages/core/src/money.ts</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'الدينار الكويتي والبحريني والريال العُماني تحمل ثلاث خانات؛ والثماني الأخرى خانتان. هذا هو الفرق الذي لا يظهر أبداً في السوق التي بُني فيها نظامٌ للدولار ثم كُيِّف: تقريبٌ عام إلى خانتين يُفسد كل مبلغ كويتي يمرّ عليه. افتحوا أي فاتورة في النسخة التجريبية — عدّ الخانات أسرع فحص على هذه الصفحة.'
          : 'The Kuwaiti and Bahraini dinar and the Omani rial carry three; the other eight carry two. This is the difference that never shows up in the home market of a system built for dollars and adapted afterwards: a global rounding to two corrupts every Kuwaiti amount it touches. Open any invoice in the demo — counting the decimal places is the fastest check on this page.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   08 — What the product is, and what it is next to
   ═══════════════════════════════════════════════════════════════════════════ */

/** The six states of a job — `packages/core/src/states.ts`, and §02 of `/what-we-do/`. */
const SPAN: Bi[] = [
  { en: 'Enquiry', ar: 'استفسار' },
  { en: 'Quote', ar: 'عرض سعر' },
  { en: 'Award', ar: 'ترسية' },
  { en: 'Execution', ar: 'تنفيذ' },
  { en: 'Documents', ar: 'مستندات' },
  { en: 'Invoice', ar: 'فاتورة' },
]

/** The five exclusions, verbatim from `/what-we-do/` §07. */
const OUTSIDE: Bi[] = [
  { en: 'Warehouse management', ar: 'إدارة المستودعات' },
  { en: 'Purchase orders', ar: 'أوامر الشراء' },
  { en: 'Native mobile apps', ar: 'تطبيقات جوال أصلية' },
  { en: 'Kuwait customs filing', ar: 'التقديم الجمركي في الكويت' },
  { en: 'Master carrier documents', ar: 'مستندات الناقل الرئيسية' },
]

/**
 * Narrow and complete, drawn as a span rather than argued as a paragraph.
 *
 * The unbroken bar is the claim — one record from enquiry to invoice with no
 * exits — and the detached blocks under it are the five things deliberately
 * outside it. Drawing the exclusions at the same weight as the scope is the
 * whole honesty of the figure: a scope diagram that shows only what is included
 * is a logo wall with rectangles.
 */
export function ScopeSpan({ lang }: { lang: Lang }) {
  const trackStart = 40
  const trackEnd = 960
  const cell = (trackEnd - trackStart) / SPAN.length

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: 'One record, six states, no exits — and what is deliberately outside it',
            ar: 'سجل واحد، ست حالات، بلا مخارج — وما هو خارجه عن قصد',
          }}
        />

        <svg viewBox="0 0 1000 300" role="img" aria-labelledby="scope-title" className="cmp-svg">
          <title id="scope-title">
            {lang === 'ar'
              ? 'شريط متصل يبيّن حالات الشحنة الست، وتحته كتل منفصلة لما هو خارج المنتج عن قصد'
              : 'An unbroken bar showing the six states of a job, and detached blocks beneath it for what is deliberately outside the product'}
          </title>

          {SPAN.map((state, index) => (
            <g key={state.en}>
              <rect
                x={trackStart + index * cell}
                y="70"
                width={cell - 3}
                height="56"
                className="fig-span"
              />
              <text
                x={trackStart + index * cell + (cell - 3) / 2}
                y="104"
                textAnchor="middle"
                className="fig-span__label"
              >
                {state[lang]}
              </text>
            </g>
          ))}
          <text x={trackStart} y="52" className="cmp-note">
            {lang === 'ar'
              ? 'سجل واحد — لا يُعاد إدخاله في نظام ثانٍ'
              : 'one record — never re-keyed into a second system'}
          </text>

          {/* The gap is the argument. These are drawn detached and hatched
              because they are not a roadmap and not a gap in the product; they
              are five decisions, and each of them has a paragraph on
              `/what-we-do/` saying why. */}
          {OUTSIDE.map((item, index) => {
            const width = (trackEnd - trackStart) / OUTSIDE.length
            return (
              <g key={item.en}>
                <rect
                  x={trackStart + index * width}
                  y="196"
                  width={width - 12}
                  height="52"
                  className="fig-span--out"
                />
                <text
                  x={trackStart + index * width + (width - 12) / 2}
                  y="226"
                  textAnchor="middle"
                  className="cmp-axis-label"
                >
                  {item[lang]}
                </text>
              </g>
            )
          })}
          <text x={trackStart} y="178" className="cmp-axis-label">
            {lang === 'ar'
              ? 'خارج المنتج بقرار — لا على خارطة الطريق'
              : 'outside the product by decision — not on the roadmap'}
          </text>
        </svg>

        <Source>/what-we-do/ §02 and §07 · packages/core/src/states.ts</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'الشريط الأعلى متصل لأن الشحنة لا تخرج منه: كل حالة تسلّم التالية ما تحتاجه، فلا يُعاد كتابة شيء ولا يمكن أن يُكتب مختلفاً. والكتل السفلى ليست خارطة طريق ولا نقصاً — بل خمسة قرارات، لكل واحد منها فقرة تشرح سببه. من يحتاج إحداها فعلاً ينبغي أن يعرف ذلك اليوم لا في الأسبوع الثالث.'
          : 'The upper bar is unbroken because the job never leaves it: each state hands the next one everything it needs, so nothing is retyped and nothing can be retyped differently. The lower blocks are not a roadmap and not a shortfall — they are five decisions, each with a paragraph saying why. Somebody who genuinely needs one of them should know that today rather than in week three.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   09 — The fifteen days, as a chart of them
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `docs/Qabandi_Pilot_15_Day.md` §4, drawn.
 *
 * The site offers a fifteen-day pilot in four places and has never once shown
 * what the fifteen days are. That plan exists, it is specific, and it is dull
 * in the way a real plan is dull — which is exactly why printing it is worth
 * more than another sentence promising that it exists. The three demo-ready
 * markers are the document's own, in its own words.
 */
const PILOT: { from: number; to: number; block: Bi; done: Bi }[] = [
  {
    from: 1,
    to: 2,
    block: { en: 'Data intake', ar: 'استلام البيانات' },
    done: {
      en: 'we can read your rate card and know it will import',
      ar: 'نقرأ بطاقة أسعاركم ونعرف أنها ستُستورد',
    },
  },
  {
    from: 3,
    to: 5,
    block: { en: 'Foundation', ar: 'الأساس' },
    done: {
      en: 'two entities, users, roles, your branding on every screen',
      ar: 'كيانان ومستخدمون وأدوار وهويتكم على كل شاشة',
    },
  },
  {
    from: 6,
    to: 7,
    block: { en: 'Pricing', ar: 'التسعير' },
    done: {
      en: 'a real lane prices in under ten seconds, as a sendable PDF',
      ar: 'مسار حقيقي يُسعَّر في أقل من عشر ثوانٍ بملف قابل للإرسال',
    },
  },
  {
    from: 8,
    to: 9,
    block: { en: 'Enquiry queue', ar: 'طابور الاستفسارات' },
    done: {
      en: 'owner, status and an SLA clock on every enquiry',
      ar: 'مالك وحالة وعدّاد لكل استفسار',
    },
  },
  {
    from: 10,
    to: 11,
    block: { en: 'Jobs and documents', ar: 'الشحنات والمستندات' },
    done: { en: 'a populated operations board', ar: 'لوحة عمليات ممتلئة' },
  },
  {
    from: 12,
    to: 12,
    block: { en: 'Tracking', ar: 'التتبّع' },
    done: { en: 'public tracking page and customer portal', ar: 'صفحة تتبّع عامة وبوابة للعميل' },
  },
  {
    from: 13,
    to: 13,
    block: { en: 'The details that sell', ar: 'التفاصيل التي تُقنع' },
    done: {
      en: 'a customs hold and a demurrage clock, live',
      ar: 'تعليق جمركي وعدّاد أرضيات يعملان',
    },
  },
  {
    from: 14,
    to: 14,
    block: { en: 'Arabic', ar: 'العربية' },
    done: {
      en: 'native RTL, reviewed by a native speaker',
      ar: 'اتجاه عربي أصيل يراجعه ناطق بالعربية',
    },
  },
  {
    from: 15,
    to: 15,
    block: { en: 'Rehearsal', ar: 'التجربة النهائية' },
    done: { en: 'two people can each run the demo cold', ar: 'يستطيع شخصان تقديم العرض دون تحضير' },
  },
]

export function PilotGantt({ lang }: { lang: Lang }) {
  const gutter = 232
  const trackStart = gutter + 20
  const trackEnd = 960
  const day = (n: number) => trackStart + ((n - 1) / 15) * (trackEnd - trackStart)
  const rowHeight = 34
  const firstRow = 64

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <Title
          lang={lang}
          text={{
            en: 'Fifteen working days, and what is finished on each of them',
            ar: 'خمسة عشر يوم عمل، وما يكتمل في كل منها',
          }}
        />

        <svg
          viewBox={`0 0 1000 ${firstRow + PILOT.length * rowHeight + 40}`}
          role="img"
          aria-labelledby="pilot-title"
          className="cmp-svg"
        >
          <title id="pilot-title">
            {lang === 'ar'
              ? 'مخطط زمني لتسع كتل عمل موزّعة على خمسة عشر يوماً'
              : 'A bar chart of nine blocks of work across fifteen working days'}
          </title>

          {[1, 3, 5, 7, 9, 11, 13, 15].map((n) => (
            <g key={n}>
              <line
                x1={day(n)}
                y1={firstRow - 24}
                x2={day(n)}
                y2={firstRow + PILOT.length * rowHeight - 18}
                className="fig-grid"
              />
              <text x={day(n)} y={firstRow - 34} textAnchor="middle" className="cmp-axis-label">
                {n === 1 ? (lang === 'ar' ? 'اليوم 1' : 'day 1') : n}
              </text>
            </g>
          ))}

          {PILOT.map((block, index) => {
            const y = firstRow + index * rowHeight
            const x = day(block.from)
            const width = day(block.to + 1) - x - 6

            return (
              <g key={block.block.en}>
                <text x="0" y={y + 4} className="cmp-track-label">
                  {block.block[lang]}
                </text>
                <rect x={x} y={y - 11} width={width} height="20" className="fig-gantt" rx="2" />
                <text x={x + width + 14} y={y + 4} className="cmp-axis-label">
                  {block.done[lang]}
                </text>
              </g>
            )
          })}
        </svg>

        <Source>docs/Qabandi_Pilot_15_Day.md §4</Source>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'خمسة عشر يوم عمل تبدأ يوم تصل بياناتكم لا يوم التوقيع، بأجر ثابت. الخطة نفسها التي نعمل بها، ومملّة بالقدر الذي تكون عليه خطة حقيقية: يومان لقراءة بطاقة أسعاركم، ويوم كامل للعربية، ويوم أخير للتجربة على نظام لا يعمل فيه الإنترنت. لا شيء يُبنى فيها يُرمى بعدها.'
          : 'Fifteen working days that start the day your data arrives rather than the day you sign, for a fixed fee. It is the plan we actually work to, and it is dull in the way a real plan is dull: two days to read your rate card, a whole day for Arabic, and a last day rehearsing against a room with no internet. Nothing built in it is thrown away.'}
      </figcaption>
    </figure>
  )
}
