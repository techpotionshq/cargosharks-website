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
 * ## The BOM is not optional
 *
 * Excel on Windows reads a CSV without a byte-order mark in the system ANSI
 * codepage, which turns every Arabic customer name into mojibake. Three bytes
 * fix it, and this product ships to a market where half the customer names are
 * Arabic. The same reasoning as `accounting/export.ts`.
 */

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import {
  REPORT_DIMENSIONS,
  marginByDimension,
  yearToDate,
  type ReportDimension,
} from '@/features/reports/queries'

export const dynamic = 'force-dynamic'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * RFC 4180 quoting, plus the formula guard.
 *
 * A field beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and
 * by Sheets when the file is opened — a customer named `=cmd|...` is a
 * spreadsheet injection, and the name came from an operator's keyboard. The
 * leading apostrophe is the standard defence and is invisible in the cell.
 */
function cell(value: string | number | null | undefined): string {
  const text = String(value ?? '')
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${guarded.replace(/"/g, '""')}"`
}

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

  const lines = [
    header.map(cell).join(','),
    ...rows.map((row) =>
      [
        row.labelEn,
        row.labelAr ?? '',
        row.jobCount,
        row.revenue,
        row.cost,
        row.grossProfit,
        row.currency,
        period.from,
        period.to,
      ]
        .map(cell)
        .join(','),
    ),
  ]

  // CRLF, because that is what RFC 4180 says and what Excel expects.
  const body = `﻿${lines.join('\r\n')}\r\n`

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="margin-by-${dimension}-${period.from}-to-${period.to}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}
