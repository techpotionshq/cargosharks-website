import { QrCode, SealCheck } from '@phosphor-icons/react/dist/ssr'
import { Accrue, DaysSince } from '@/components/Accrue'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DEMURRAGE_PER_DAY, einvoicing, FREE_TIME_ENDED, type Lang, leak } from '@/content/copy'

/**
 * The drawn evidence the home page and the market pages share: an invoice with
 * VAT per line, a dinar amount kept to three decimals, and a demurrage charge
 * line still accruing. Each one is a document the product actually produces,
 * set as a document (square, white, hairlines), so a section that shows one
 * reads as proof rather than as an illustration of a claim.
 */

/**
 * One invoice from a Saudi branch, VAT decided line by line. It adds up:
 * 6,400 + 850 + 600 + 3,200 = 11,050, and VAT is 15% of the one
 * standard-rated line, 600, which is 90. SAR at two decimals, because that is
 * the riyal: the site never rounds a dinar to two and never pads a riyal to three.
 */
export function InvoiceExample({ lang }: { lang: Lang }) {
  const ex = einvoicing.example
  const num = 'figures text-end font-mono'

  return (
    <figure className="overflow-hidden rounded-lg border border-line bg-paper-lift shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="figures font-mono text-small text-ink">INV-DMM-2026-00412</p>
          <p className="text-label text-ink-faint">
            {lang === 'ar' ? 'شنغهاي ← الدمام · بحري بحاوية كاملة' : 'Shanghai → Dammam · Sea FCL'}
          </p>
        </div>
        <Badge variant="live">
          <SealCheck weight="fill" className="size-3.5" aria-hidden="true" />
          {ex.stamp[lang]}
        </Badge>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-5">{ex.head.charge[lang]}</TableHead>
            <TableHead>{ex.head.treatment[lang]}</TableHead>
            <TableHead className="text-end">{ex.head.amount[lang]}</TableHead>
            <TableHead className="pe-5 text-end">{ex.head.vat[lang]}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ex.rows.map((row) => (
            <TableRow key={row.charge.en}>
              <TableCell className="ps-5 font-medium text-ink">{row.charge[lang]}</TableCell>
              <TableCell className="text-ink-dim">{row.treatment[lang]}</TableCell>
              <TableCell className={`${num} text-ink`}>{row.amount}</TableCell>
              <TableCell className={`${num} pe-5 text-ink`}>{row.vat}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-paper-sunk/60">
            <TableCell className="ps-5 font-medium text-ink" colSpan={2}>
              {ex.total[lang]}
            </TableCell>
            <TableCell className={`${num} text-ink`}>{ex.totalAmount}</TableCell>
            <TableCell className={`${num} pe-5 text-ink`}>{ex.totalVat}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-4">
        <figcaption className="max-w-[44ch] text-label text-ink-faint">
          {ex.caption[lang]}
        </figcaption>
        <div className="flex items-center gap-3">
          <p className="figures font-mono text-body font-semibold text-ink">SAR {ex.grand}</p>
          <QrCode className="size-9 text-ink" weight="regular" aria-hidden="true" />
        </div>
      </div>
    </figure>
  )
}

/**
 * The same freight line kept to three decimals and rounded to two. The
 * difference per line is half a fils at most, and across a thousand lines that
 * is up to KWD 5.000 that the invoice and the ledger disagree about.
 */
export function DecimalsCard({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const rows = [
    {
      label: ar ? 'يُحفظ هنا' : 'Kept here',
      value: '1,284.375',
      tone: 'text-ink',
      note: ar ? 'ثلاث خانات، حتى الفلس' : 'three decimals, to the fils',
    },
    {
      label: ar ? 'نظام مبني للدولار' : 'A system built for dollars',
      value: '1,284.38',
      tone: 'text-ink-faint line-through decoration-amber decoration-2',
      note: ar ? 'خانتان، والفلس الخامس يضيع' : 'two decimals, five fils gone',
    },
  ]
  return (
    <figure className="overflow-hidden rounded-lg border border-line bg-paper-lift shadow-sm">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <p className="text-small font-semibold text-ink">
          {ar ? 'بند شحن بحري واحد' : 'One sea freight line'}
        </p>
        <p className="figures font-mono text-label text-ink-faint">KWD · 3 dp</p>
      </div>
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div
            key={row.value}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-5"
          >
            <dt className="flex flex-col">
              <span className="text-small font-medium text-ink">{row.label}</span>
              <span className="text-label text-ink-faint">{row.note}</span>
            </dt>
            {/* `dir="ltr"`: an amount with its currency code is one left-to-right
                unit, and in an Arabic paragraph the code otherwise ran into
                the digits ("KWD1,284.375"). */}
            <dd dir="ltr" className="figures font-mono text-[1.75rem] font-medium leading-none">
              <span className="me-1.5 text-small text-ink-faint">KWD</span>
              {/* The strike is on the figure only: the currency is not what
                  the rounding got wrong. */}
              <span className={row.tone}>{row.value}</span>
            </dd>
          </div>
        ))}
      </dl>
      <figcaption className="border-t border-line bg-paper-sunk/60 px-5 py-3.5 text-small text-ink-dim">
        {ar
          ? 'نصف فلس في كل بند يصبح حتى 5.000 د.ك على ألف بند.'
          : 'Half a fils on every line becomes up to KWD 5.000 across a thousand lines.'}
      </figcaption>
    </figure>
  )
}

/**
 * A demurrage charge line, still accruing. The day count and the amount both
 * come from `FREE_TIME_ENDED`, so they agree with each other and with today,
 * and the amount moves in the browser at the real per-second rate.
 */
export function FreeTimeCard({ lang }: { lang: Lang }) {
  const line = leak.line
  return (
    <figure className="mx-auto w-full max-w-[32rem] bg-paper-lift text-ink shadow-2xl lg:me-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line-strong px-6 py-4">
        <p className="figures font-mono text-body">{line.container}</p>
        <p className="text-small text-ink-faint">
          {lang === 'ar' ? 'الشعيبة · بحري بحاوية كاملة' : 'Shuaiba · Sea FCL'}
        </p>
      </div>
      <dl className="divide-y divide-line px-6">
        <div className="flex justify-between gap-6 py-3">
          <dt className="text-small text-ink-faint">{line.startedLabel[lang]}</dt>
          <dd className="figures font-mono text-small text-ink-dim">{line.startedValue[lang]}</dd>
        </div>
        <div className="flex justify-between gap-6 py-3">
          <dt className="text-small text-ink-faint">{line.rateLabel[lang]}</dt>
          <dd className="figures font-mono text-small text-ink-dim">{line.rateValue[lang]}</dd>
        </div>
        <div className="flex justify-between gap-6 py-3">
          <dt className="text-small text-ink-faint">{line.daysLabel[lang]}</dt>
          <dd className="figures font-mono text-small text-ink-dim">
            <DaysSince since={FREE_TIME_ENDED} /> {line.daysTail[lang]}
          </dd>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-t border-line-strong py-5">
          <dt className="text-small font-medium text-ink-dim">{line.totalLabel[lang]}</dt>
          <dd className="figures flex items-baseline gap-2 font-mono">
            <span className="text-small text-ink-faint">KWD</span>
            <span className="text-[2rem] font-medium leading-none tracking-[-0.02em] text-ink">
              <Accrue since={FREE_TIME_ENDED} perDay={DEMURRAGE_PER_DAY} />
            </span>
          </dd>
        </div>
      </dl>
      <figcaption className="border-t border-line px-6 py-3.5 text-small text-ink-dim">
        {line.written[lang]}
      </figcaption>
    </figure>
  )
}
