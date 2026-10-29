import { Check } from '@phosphor-icons/react/dist/ssr'
import { ChartFigure } from '@/components/charts/ChartFigure'
import { AccrualChart } from '@/components/charts/charts'
import { AllocationBar, ChargeableChart, MilestoneChart } from '@/components/charts/figures-a'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
 * These are buyer-facing pages, so a figure states what it measures in plain
 * language and stops there — the file a number is transcribed from is recorded
 * in the source comments above each drawing, not printed under it, where a repo
 * path means nothing to a reader and reads as a leak.
 *
 * ## How they are drawn
 *
 * Every figure sits in `ChartFigure` (title, the drawing, a caption of one or
 * two sentences) and follows DESIGN.md, "Charts and tables". A quantity is a
 * Recharts bar chart from `components/charts/` (chargeable weight, milestone
 * counts, the allocation split); a matrix is `ui/table`; a list of facts is a
 * ledger; the onboarding plan is an HTML day grid, because nine blocks tiling
 * fifteen columns is a layout a browser does exactly and mirrors for Arabic on
 * its own. Numbers stay left-to-right inside their own runs.
 *
 * `FigureTitle`, `figureFrame` and `FigureSvg` below are the old SVG frame,
 * kept only while `comparison-figures.tsx`, `comparison-leads.tsx` and
 * `illustrations.tsx` still draw with them.
 */


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
 *
 * Four bars, not five: FCL has no volumetric step, and a bar of length zero
 * would read as "cheapest" rather than "not this arithmetic", so the caption
 * says how it is billed instead.
 */
export function ChargeableColumns({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const rows = RULES.flatMap((rule) => {
    const kg = chargeableKg(rule)
    return kg === null
      ? []
      : [
          {
            key: rule.key,
            name: rule.label[lang],
            note: `÷ ${(rule.divisor ?? 0).toLocaleString('en-US')}`,
            kg,
          },
        ]
  })

  return (
    <ChartFigure
      title={
        ar
          ? 'منصة واحدة، 120 × 100 × 100 سم و180 كجم: الوزن المحتسب في أربع وسائل شحن'
          : 'One pallet, 120 × 100 × 100 cm and 180 kg: the weight billed in four modes'
      }
      meta={ar ? 'القاسم بوحدة سم³/كجم' : 'Divisors in cm³/kg'}
      caption={
        ar
          ? 'لا تُسعِّر أي وسيلة الوزن الذي على الميزان. البحري بحاوية يُسعَّر لكل حاوية، بلا وزن حجمي. وكل قاسم إعداد يعدّله المسؤول.'
          : 'No mode bills what the scale reads. Sea FCL is priced per container, with no volumetric step. Each divisor is a setting an administrator edits.'
      }
    >
      <ChargeableChart lang={lang} rows={rows} grossKg={PALLET.grossKg} />
    </ChartFigure>
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
  const final = (CLOCK.days - CLOCK.freeDays) * CLOCK.perDiem
  return (
    <ChartFigure
      title={
        lang === 'ar'
          ? 'حاوية واحدة: خمسة أيام سماح، ثم 28.000 د.ك في اليوم'
          : 'One container: five free days, then KWD 28.000 a day'
      }
      meta={lang === 'ar' ? 'أرقام النسخة التجريبية' : 'The demo’s own figures'}
      caption={
        lang === 'ar'
          ? `يبدأ العدّاد مع المرحلة، ويُكتب بند التكلفة على الشحنة كل يوم: ${CLOCK.days - CLOCK.freeDays} يوماً × 28.000 = ${final}.000 د.ك.`
          : `The clock starts with the milestone and writes a charge line on the job each day: ${CLOCK.days - CLOCK.freeDays} days × 28.000 = KWD ${final}.000.`
      }
    >
      <AccrualChart lang={lang} freeDays={CLOCK.freeDays} perDiem={CLOCK.perDiem} days={CLOCK.days} />
    </ChartFigure>
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
  const ar = lang === 'ar'
  const rows = allocate()
  const totalCbm = HOUSES.reduce((sum, house) => sum + house.cbm, 0)
  const settled = rows.reduce((sum, row) => sum + row.final, 0)
  const floors = rows.reduce((sum, row) => sum + row.floored, 0)
  const spare = rows.reduce((sum, row) => sum + row.extraFils, 0)
  const num = 'figures text-end font-mono'

  return (
    <ChartFigure
      title={
        ar
          ? '100.000 د.ك تكلفة رئيسية على ثلاث بوالص فرعية، حسب الحجم'
          : 'KWD 100.000 of master cost, across three houses, by volume'
      }
      meta={ar ? 'د.ك' : 'KWD'}
      caption={
        ar
          ? `بعد حطّ كل حصة يبقى ${(spare / 1000).toFixed(3)} د.ك، فيذهب كل فلس إلى أكبر كسر متبقٍّ. والعمود الأخير يجمع ${settled.toFixed(3)} بالضبط.`
          : `Flooring every share leaves ${(spare / 1000).toFixed(3)}, so each spare fils goes to the largest remainder. The posted column sums to ${settled.toFixed(3)} exactly.`
      }
    >
      <div className="flex flex-col gap-6">
        <AllocationBar
          lang={lang}
          rows={rows.map((row) => ({ ref: row.ref, cbm: row.cbm, posted: row.final.toFixed(3) }))}
        />
        <Table className="min-w-[36rem]">
          <TableHeader>
            <TableRow className="border-line-strong">
              <TableHead className="text-heading">{ar ? 'البوليصة' : 'House'}</TableHead>
              <TableHead className="text-end text-heading">{ar ? 'الحجم (م³)' : 'CBM'}</TableHead>
              <TableHead className="text-end text-heading">
                {ar ? 'الحصة الدقيقة' : 'Exact share'}
              </TableHead>
              <TableHead className="text-end text-heading">{ar ? 'بعد الحطّ' : 'Floored'}</TableHead>
              <TableHead className="text-end text-heading">
                {ar ? 'الفلس المتبقّي' : 'Spare fils'}
              </TableHead>
              <TableHead className="text-end text-heading">{ar ? 'المرحَّل' : 'Posted'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.ref} className="border-line">
                <TableCell className="text-start font-mono font-medium text-heading">
                  {row.ref}
                </TableCell>
                <TableCell className={num}>
                  {row.cbm}
                </TableCell>
                <TableCell className={`${num} text-ink-dim`}>
                  {row.exact.toFixed(6)}
                </TableCell>
                <TableCell className={num}>
                  {row.floored.toFixed(3)}
                </TableCell>
                <TableCell className={num}>
                  <span dir="ltr">{row.extraFils ? '+0.001' : '0.000'}</span>
                </TableCell>
                <TableCell className={`${num} font-semibold text-heading`}>
                  {row.final.toFixed(3)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <tfoot className="border-t border-line-strong">
            <TableRow className="border-0">
              <TableCell className="font-semibold text-heading">{ar ? 'المجموع' : 'Total'}</TableCell>
              <TableCell className={num}>
                {totalCbm}
              </TableCell>
              <TableCell className={`${num} text-ink-dim`}>
                {MASTER_COST.toFixed(6)}
              </TableCell>
              <TableCell className={num}>
                {floors.toFixed(3)}
              </TableCell>
              <TableCell className={num}>
                <span dir="ltr">+{(spare / 1000).toFixed(3)}</span>
              </TableCell>
              <TableCell className={`${num} font-semibold text-heading`}>
                {settled.toFixed(3)}
              </TableCell>
            </TableRow>
          </tfoot>
        </Table>
      </div>
    </ChartFigure>
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
  const ar = lang === 'ar'
  const yes = ar ? 'مسموح' : 'granted'
  const no = ar ? 'غير مسموح' : 'not granted'

  return (
    <ChartFigure
      title={
        ar
          ? 'سبعة أدوار مُعدّة مسبقاً، وستة مفاتيح يسأل عنها المدقق'
          : 'Seven seeded roles, six keys an auditor asks about'
      }
      caption={
        ar
          ? 'ثلاثة أدوار لا تحمل أياً منها، ومدير العمليات لا يصدر فاتورة ولا يعتمد فاتورة مورّد. ومسؤول النظام يحمل كل مفتاح، حتى ما يُضاف لاحقاً.'
          : 'Three roles hold none of these, and Operations never issues an invoice or approves a bill. Administrator holds every key, even ones added later.'
      }
    >
      <Table className="min-w-[40rem] table-fixed">
        <TableHeader>
          <TableRow className="border-line-strong">
            <TableHead className="w-[10.5rem] align-bottom text-heading">
              {ar ? 'الدور' : 'Role'}
            </TableHead>
            {DUTY_ACTIONS.map((action) => (
              <TableHead
                key={action.key}
                scope="col"
                className="h-auto pb-3 text-center align-bottom font-semibold whitespace-normal text-heading"
              >
                {action.label[lang]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {DUTY_ROLES.map((role) => (
            <TableRow key={role.key} className="border-line">
              <TableHead scope="row" className="h-11 font-medium text-heading">
                {role.label[lang]}
              </TableHead>
              {DUTY_ACTIONS.map((action) => {
                const held = role.holds.includes(action.key)
                return (
                  <TableCell key={action.key} className="py-0 text-center align-middle">
                    {held ? (
                      <Check
                        weight="bold"
                        aria-hidden="true"
                        className="mx-auto size-[18px] text-blue"
                      />
                    ) : (
                      <span aria-hidden="true" className="mx-auto block h-px w-3 bg-line-strong" />
                    )}
                    <span className="sr-only">{held ? yes : no}</span>
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ChartFigure>
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
  const ar = lang === 'ar'
  // "Sea FCL · import" splits at the dot into the axis label's two lines.
  const rows = TEMPLATES.map((template) => {
    const [mode = '', direction = ''] = template.flow[lang].split(' · ')
    return { key: template.flow.en, mode, direction, steps: template.steps.length }
  })

  return (
    <ChartFigure
      title={
        ar
          ? 'ستة قوالب مراحل مُعدّة مسبقاً، وعدد مراحل كل منها'
          : 'Six seeded milestone templates, and how many steps each has'
      }
      caption={
        ar
          ? 'ثماني مراحل أو تسع بحراً، وست جواً، وخمس براً. قائمة واحدة ستكون أطول من اللازم على الطريق أو أقصر منه على الماء.'
          : 'Eight or nine steps by sea, six by air and five by road. One checklist would be too long for the road or too short for the water.'
      }
    >
      <MilestoneChart lang={lang} rows={rows} />
      {/* The steps themselves, for a screen reader: the bars give only the
          count, and the names are what the count is of. */}
      <div className="sr-only">
        {TEMPLATES.map((template) => (
          <p key={template.flow.en}>
            {template.flow[lang]}:{' '}
            {template.steps.map((step) => MILESTONE_NAMES[step]?.[lang] ?? step).join(ar ? '، ' : ', ')}
          </p>
        ))}
      </div>
    </ChartFigure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   06 — The charge catalogue, as a waffle
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `CHARGE_TYPES` from `packages/db/src/seed.ts`, grouped by the rating basis
 * each row names.
 *
 * Twenty-one named rows over six functions. The seed has a twenty-second,
 * `other` (flat), which is where a priced line lands when nobody can yet name
 * its charge; it is a holding pen rather than a charge type, so the figure
 * counts it in the caption and not in the grid. The figure exists to make one sentence
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
  const ar = lang === 'ar'
  const total = CHARGE_BASES.reduce((sum, basis) => sum + basis.charges.length, 0)
  const sentence = (text: string) => (ar ? text : text.charAt(0).toUpperCase() + text.slice(1))

  return (
    <ChartFigure
      title={
        ar
          ? `${total} نوعاً مسمّى من التكاليف، على ست طرق لتسعيرها`
          : `${total} named charge types, over six ways of pricing them`
      }
      meta={ar ? 'طريقة التسعير · العدد' : 'Pricing basis · count'}
      caption={
        ar
          ? 'إضافة رسم إعدادٌ: يختار المسؤول إحدى الطرق الست. وبند إضافي، «رسوم أخرى» بمبلغ مقطوع، يستقبل ما لم يُسمَّ بعد.'
          : 'Adding a charge is a setting: an administrator picks one of the six bases. One more row, Other charge (flat), holds anything not yet named.'
      }
    >
      {/* A ledger, one row per basis: the grouping is the information, and a
          grid of twenty-one tags made the reader count squares to find it. */}
      <dl className="divide-y divide-line border-y border-line">
        {CHARGE_BASES.map((basis) => (
          <div
            key={basis.key}
            className="grid gap-1 py-3.5 sm:grid-cols-[11rem_1fr] sm:items-baseline sm:gap-6"
          >
            <dt className="flex items-baseline justify-between gap-3 text-small font-semibold text-heading sm:justify-start">
              {sentence(basis.label[lang])}
              <span className="figures font-mono text-label font-medium text-blue-ink">
                {basis.charges.length}
              </span>
            </dt>
            <dd className="text-small text-ink-dim">
              {basis.charges.map((charge) => charge[lang]).join(ar ? '، ' : ', ')}
            </dd>
          </div>
        ))}
      </dl>
    </ChartFigure>
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
  const ar = lang === 'ar'
  const three = CURRENCIES.filter((currency) => currency.minor === 3)
  const two = CURRENCIES.filter((currency) => currency.minor === 2)

  return (
    <ChartFigure
      title={
        ar
          ? `${three.length} من ${CURRENCIES.length} عملة مُعدّة تحمل ثلاث خانات عشرية`
          : `${three.length} of ${CURRENCIES.length} seeded currencies carry three decimals`
      }
      caption={
        ar
          ? 'الدينار الكويتي والبحريني والريال العُماني بثلاث خانات. تقريبها إلى خانتين يُضيع حتى خمسة فلوس في كل بند.'
          : 'The Kuwaiti and Bahraini dinar and the Omani rial carry three decimals. Rounding them to two loses up to five fils on every line.'
      }
    >
      {/* Two rows rather than eleven tags: the grouping is the information. */}
      <dl className="divide-y divide-line border-y border-line">
        {[
          { label: ar ? 'ثلاث خانات' : 'Three decimals', list: three, strong: true },
          { label: ar ? 'خانتان' : 'Two decimals', list: two, strong: false },
        ].map((row) => (
          <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:items-baseline sm:gap-6">
            <dt className="text-small font-semibold text-heading">{row.label}</dt>
            <dd
              dir="ltr"
              className={`flex flex-wrap gap-x-4 gap-y-1 font-mono text-small ${
                row.strong ? 'font-semibold text-blue-ink' : 'text-ink-dim'
              } ${ar ? 'justify-end sm:justify-start' : ''}`}
            >
              {row.list.map((currency) => (
                <span key={currency.code}>{currency.code}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-5">
          <p className="text-small font-semibold text-heading">
            {ar ? 'ما يحفظه هذا النظام' : 'What this system stores'}
          </p>
          <p dir="ltr" className="figures font-mono text-[2rem] font-medium leading-none text-heading">
            <span className="me-2 text-small text-ink-faint">KWD</span>12.34
            <span className="text-blue">5</span>
          </p>
          <p className="text-small text-ink-dim">
            {ar ? 'الخانات الثلاث، من قاعدة البيانات حتى الفاتورة.' : 'All three decimals, from the database to the invoice.'}
          </p>
        </div>
        {/* The wrong answer on the dark navy rather than a beige box: the
            owner asked for the darker colour, and the contrast now carries the
            comparison instead of a tint nobody reads as meaning anything. */}
        <div className="flex flex-col gap-3 rounded-lg bg-void p-5">
          <p className="text-small font-semibold text-on-void">
            {ar ? 'ما يحفظه نظام بُني للدولار' : 'What a system built for dollars stores'}
          </p>
          <p dir="ltr" className="figures font-mono text-[2rem] font-medium leading-none text-on-void">
            <span className="me-2 text-small text-on-void-faint">KWD</span>12.35
            <span className="text-amber">–</span>
          </p>
          <p className="text-small text-on-void-dim">
            {ar ? 'الخانة الثالثة تضيع عند التقريب.' : 'The third decimal is rounded away.'}
          </p>
        </div>
      </div>
    </ChartFigure>
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
  const ar = lang === 'ar'

  return (
    <ChartFigure
      title={
        ar
          ? 'سجل واحد، ست حالات، بلا مخارج، وما هو خارجه عن قصد'
          : 'One record, six states, no exits, and what is deliberately outside it'
      }
      caption={
        ar
          ? 'كل حالة تسلّم التالية ما تحتاجه، فلا يُعاد كتابة شيء. والخمسة تحتها خارجه بقرار، وليست على خارطة الطريق.'
          : 'Each state hands the next everything it needs, so nothing is retyped. The five below are outside it by decision and are not planned.'
      }
    >
      <div className="flex flex-col gap-8">
        {/* One unbroken band: the job never leaves it. Three to a row on a
            phone, six across from `sm`, numbered so the order survives the wrap. */}
        <ol className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-lg sm:grid-cols-6">
          {SPAN.map((state, index) => (
            <li key={state.en} className="flex flex-col gap-1 bg-blue px-3 py-3.5 text-on-brand">
              <span className="figures font-mono text-label text-on-brand/80">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="text-small font-semibold">{state[lang]}</span>
            </li>
          ))}
        </ol>
        <div className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-6">
          <p className="pt-3 text-small font-semibold text-heading">
            {ar ? 'خارج المنتج بقرار' : 'Outside the product by decision'}
          </p>
          <ul className="divide-y divide-line border-b border-line sm:border-t">
            {OUTSIDE.map((item) => (
              <li key={item.en} className="py-3 text-small text-ink-dim">
                {item[lang]}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ChartFigure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   09 — The fifteen days, as a chart of them
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The fifteen-day onboarding plan from the sales set, drawn.
 *
 * The site promised fifteen days of setup in four places and never once showed
 * what the fifteen days are. That plan exists, it is specific, and it is dull
 * in the way a real plan is dull — which is exactly why printing it is worth
 * more than another sentence promising that it exists. Three of the blocks are
 * flagged `demoReady` — days 8–9, 12 and 13 — because the document marks them as
 * the moments onboarding has something to show in the room; the chart draws them
 * in the accent colour so that spine of the plan survives into the picture.
 */
const ONBOARDING: { from: number; to: number; block: Bi; done: Bi; demoReady?: boolean }[] = [
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
    demoReady: true,
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
    demoReady: true,
  },
  {
    from: 13,
    to: 13,
    block: { en: 'The details that sell', ar: 'التفاصيل التي تُقنع' },
    done: {
      en: 'a customs hold and a demurrage clock, live',
      ar: 'تعليق جمركي وعدّاد أرضيات يعملان',
    },
    demoReady: true,
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

export function OnboardingGantt({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const DAYS = 15
  const days = Array.from({ length: DAYS }, (_, index) => index + 1)
  const moments = ONBOARDING.filter((block) => block.demoReady)
  const span = (block: (typeof ONBOARDING)[number]) =>
    block.from === block.to ? `${block.from}` : `${block.from}–${block.to}`
  // The day grid: one track per working day, and the blocks placed on it by
  // `gridColumn`, so the tiling is the data's own (each block starts the day
  // after the last ends) and a gap or overlap would show as one.
  const track = { gridTemplateColumns: `repeat(${DAYS}, minmax(0, 1fr))` }

  return (
    <ChartFigure
      title={
        ar
          ? 'خمسة عشر يوم عمل، وما يكتمل في كل مرحلة'
          : 'Fifteen working days, and what is finished in each block'
      }
      meta={ar ? 'أيام العمل' : 'Working days'}
      caption={
        ar
          ? `اليوم الأول هو يوم وصول بياناتكم، والأجر ثابت. والكتل الزرقاء جاهزة للعرض: الأيام ${moments.map(span).join(' و')}.`
          : `Day one is the day your data arrives, and the fee is fixed. The blue blocks are ready to demonstrate: days ${moments.map(span).join(', ')}.`
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-[15rem_1fr]">
          {/* Day numbers over the track; on a phone the track is the full width. */}
          <div aria-hidden="true" className="hidden lg:block" />
          <div aria-hidden="true" className="grid border-b border-line-strong pb-1.5" style={track}>
            {days.map((day) => (
              <span key={day} className="figures text-center font-mono text-label text-ink-dim">
                {day}
              </span>
            ))}
          </div>
          <ol className="contents">
            {ONBOARDING.map((block) => (
              <li key={block.block.en} className="contents">
                <div className="pt-3 lg:border-b lg:border-line lg:py-2.5">
                  <p className="text-small font-semibold text-heading">
                    {block.block[lang]}
                    <span className="sr-only">
                      {ar ? `، الأيام ${span(block)}` : `, days ${span(block)}`}
                    </span>
                  </p>
                  <p className="text-label text-ink-dim">{block.done[lang]}</p>
                </div>
                <div
                  aria-hidden="true"
                  className="grid items-center border-b border-line py-2 lg:py-2.5"
                  style={{
                    ...track,
                    backgroundImage:
                      'repeating-linear-gradient(to right, var(--color-line) 0 1px, transparent 1px calc(100% / 15))',
                  }}
                >
                  <span
                    className={`mx-px h-4 rounded-[3px] ${block.demoReady ? 'bg-blue' : 'bg-heading'}`}
                    style={{ gridColumn: `${block.from} / ${block.to + 1}` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
        <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <li className="flex items-center gap-2 text-label text-ink-dim">
            <span aria-hidden="true" className="size-3 rounded-[2px] bg-heading" />
            {ar ? 'إعداد' : 'Setup'}
          </li>
          <li className="flex items-center gap-2 text-label text-ink-dim">
            <span aria-hidden="true" className="size-3 rounded-[2px] bg-blue" />
            {ar ? 'جاهز للعرض' : 'Ready to demonstrate'}
          </li>
        </ul>
      </div>
    </ChartFigure>
  )
}
