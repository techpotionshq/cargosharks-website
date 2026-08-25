/**
 * The audit trail, as a file — `FR-AD-02`, `NFR-10`.
 *
 * The log has always been complete; what it did not have was a way out. A
 * reviewer asking "who changed this, and when" could be shown a screen, and a
 * screen is not evidence you can attach to a finding, send to counsel, or keep
 * for the period a retention policy names. `Security_Measures.md` §6 listed
 * "audit search and export is not built" for that reason.
 *
 * Same query as the screen, same five filters, read through the same
 * `withActor` — so the file and the page cannot disagree, and row-level
 * security narrows the export to exactly what the person exporting could
 * already read. An export route that quietly saw more than its screen would be
 * the most valuable thing in the product to an attacker.
 *
 * ## Why the row cap is higher here, and still a cap
 *
 * The screen shows 150 because nobody reads more than that; an export exists
 * precisely to take more than fits on a screen, so it takes 10,000. It is not
 * unbounded, because an unbounded export of an append-only table on a shared
 * connection is a denial of service somebody discovers by accident. When the
 * cap binds, the file says so in a trailing row rather than simply ending —
 * a truncated audit export that looks complete is how a gap in an
 * investigation goes unnoticed.
 *
 * The BOM, the CRLF and the formula guard are all as `reports/margin.csv`,
 * for the reasons written out there.
 */

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { listAudit } from '@/features/admin/queries'
import { csvDocument } from '@/lib/csv'

export const dynamic = 'force-dynamic'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const OPERATIONS = new Set(['INSERT', 'UPDATE', 'DELETE'])
const LIMIT = 10_000

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // The same permission the screen asserts. A file route that skipped it would
  // be the whole trail behind a URL somebody could guess.
  if (!can(session, 'admin.audit.read')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const read = (key: string) => url.searchParams.get(key)?.trim() || undefined
  const date = (key: string) => {
    const value = read(key)
    return value && ISO_DATE.test(value) ? value : undefined
  }
  const op = read('op')?.toUpperCase()

  const filters = {
    table: read('table'),
    // Validated against the set rather than passed through: it reaches an
    // equality test on an enum column, and an unrecognised value should narrow
    // to nothing by being ignored rather than by erroring at the database.
    op: op && OPERATIONS.has(op) ? op : undefined,
    q: read('q'),
    from: date('from'),
    to: date('to'),
    limit: LIMIT,
  }

  const rows = await listAudit(session.actor, filters)

  const header = [
    'id',
    'at_utc',
    'operation',
    'table',
    'record_id',
    'principal',
    'principal_type',
    'branch',
    'ip',
  ]

  const body = csvDocument(
    header,
    rows.map((row) => [
      row.id,
      // ISO 8601 in UTC, not a localised date. This file is read by people in
      // more than one timezone and by machines in none of them, and a
      // localised timestamp in an audit export is how two accounts of the
      // same incident stop lining up.
      row.at.toISOString(),
      row.op,
      row.tableName,
      row.rowId,
      row.principalName ?? 'system',
      row.principalType ?? 'system',
      row.branchCode ?? '',
      row.ip ?? '',
    ]),
    rows.length === LIMIT
      ? `TRUNCATED: this export stopped at ${LIMIT} entries. Narrow the period and export again.`
      : undefined,
  )

  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="audit-${filters.table ?? 'all'}-${stamp}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}
