/**
 * The management report, as a file.
 *
 * A report that cannot leave the screen is a report that gets retyped into a
 * spreadsheet, and then the spreadsheet is what the board sees. This hands
 * back the same rows the page shows, read from the same query with the same
 * three parameters, so the two cannot disagree.
 *
 * ## Why CSV and not XLSX
 *
 * Every recipient opens it, nothing has to generate a zip container, and the
 * accounting export (0011) already established the format and the conventions
 * below. An XLSX writer would be a dependency earning its place only if
 * somebody needed formatting, and nobody has asked.
 *
 * The byte-order mark, the CRLF endings and the formula guard are all in
 * `lib/csv.ts`, with the reasoning for each. They were written here first and
 * then again in the audit export, which is one copy too many for a guard
 * against spreadsheet injection.
 */

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { csvDocument } from '@/lib/csv'
import {
  REPORT_DIMENSIONS,
  marginByDimension,
  yearToDate,
  type ReportDimension,
} from '@/features/reports/queries'

export const dynamic = 'force-dynamic'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // The same permission the page asserts. A file route that skipped it would
  // be the whole book behind a URL somebody could guess.
  if (!can(session, 'report.read')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const requested = url.searchParams.get('dimension') ?? ''
  const dimension: ReportDimension = REPORT_DIMENSIONS.includes(requested as ReportDimension)
    ? (requested as ReportDimension)
    : 'customer'

  const fallback = yearToDate()
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const period = {
    from: from && ISO_DATE.test(from) ? from : fallback.from,
    to: to && ISO_DATE.test(to) ? to : fallback.to,
  }

  const rows = await marginByDimension(session.actor, dimension, period)

  /*
    Both languages in the file, not the caller's.

    A CSV is forwarded — to a board, to an auditor, to a bank — and whoever
    opens it is not the person who exported it. Carrying both name columns
    costs one column and removes the question entirely.

    The figures are the strings PostgreSQL returned. Not formatted, not
    localised, not passed through `Number()`: a spreadsheet wants a number it
    can sum, and a thousands separator or a lost fils is how a report stops
    reconciling.
  */
  const header = [
    dimension,
    `${dimension}_ar`,
    'jobs',
    'revenue',
    'cost',
    'gross_profit',
    'currency',
    'period_from',
    'period_to',
  ]

  const body = csvDocument(
    header,
    rows.map((row) => [
      row.labelEn,
      row.labelAr ?? '',
      row.jobCount,
      row.revenue,
      row.cost,
      row.grossProfit,
      row.currency,
      period.from,
      period.to,
    ]),
  )

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="margin-by-${dimension}-${period.from}-to-${period.to}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}
