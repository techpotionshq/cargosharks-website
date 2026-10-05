/**
 * Paging for registers — one request shape, one result shape, one rule.
 *
 * Every register used to end in a bare `limit(100)` or `limit(200)` with no way
 * past it, and most of them drew their headline figures from the length of
 * what that limit let through. Live run 5 found both halves on the jobs board:
 * 336 live shipments, a hundred rows, no next page, and a "Live" tile reading
 * 100. The customers register hid Jahra Industries the same way while search
 * still found it. Nothing was lost, which is what made it dangerous: the screen
 * looked complete.
 *
 * So the rule is: a register reads a *page* — `limit` and `offset` from a
 * `PageRequest` — and a *total* from a count over the same filter, and the two
 * travel together as a `Page`. Any figure a screen prints about "how many"
 * comes from a count, never from `rows.length`.
 *
 * Offset rather than keyset paging, deliberately. The registers sort on columns
 * people choose by (ETA, name, issue date) that are not unique, page counts are
 * in the hundreds rather than the millions, and a page number is a URL an
 * operator can send a colleague. Keyset paging buys speed at depths these
 * screens never reach, and costs the "page 3 of 7" people actually read.
 */

import { sql, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { Tx } from '@qabandi/db'

/**
 * Rows per page. The board was designed around forty visible rows; fifty is
 * that and a short scroll, and few enough that a page renders in one round trip.
 */
export const PAGE_SIZE = 50

export interface PageRequest {
  /** One-based, as it appears in the URL. */
  readonly page: number
  readonly size: number
}

export interface Page<T> {
  readonly rows: T[]
  /** Every row the filter matches, not only the ones on this page. */
  readonly total: number
  readonly page: number
  readonly size: number
}

/**
 * The page a query string asks for.
 *
 * `searchParams.page` is whatever a stranger typed, so anything that is not a
 * positive whole number is page one rather than an error — the same "a filter
 * the register cannot honour becomes no filter" rule as `lib/filters.ts`. The
 * ceiling stops `?page=1e9` turning into an offset Postgres has to walk.
 */
export function pageRequest(raw: string | string[] | undefined, size = PAGE_SIZE): PageRequest {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = value !== undefined && /^\d{1,6}$/.test(value) ? Number(value) : 1
  return { page: Math.max(1, parsed), size }
}

/** Rows to skip for a request. */
export function pageOffset(request: PageRequest): number {
  return (request.page - 1) * request.size
}

/** How many pages a total spans; at least one, so "page 1 of 1" reads for an empty register. */
export function pageCount(page: Pick<Page<unknown>, 'total' | 'size'>): number {
  return Math.max(1, Math.ceil(page.total / page.size))
}

/**
 * One page of rows already in memory.
 *
 * For the fixture branch of every register read — `usePilotFixtures()` returns
 * the whole demo dataset, and slicing it here is what makes the offline demo
 * page exactly as the database does — and for the few registers whose filter
 * can only run in JavaScript.
 */
export function pageOf<T>(rows: readonly T[], request: PageRequest): Page<T> {
  const offset = pageOffset(request)
  return {
    rows: rows.slice(offset, offset + request.size),
    total: rows.length,
    page: request.page,
    size: request.size,
  }
}

/**
 * One page from the database: the rows and their count, inside the caller's
 * transaction.
 *
 * Sequential rather than `Promise.all`: both run on the one connection
 * `withActor` holds, so there is no parallelism to gain, and the count's
 * filter is the caller's to keep identical to the rows' — the reason this takes
 * two callbacks rather than building either query itself.
 */
export async function readPage<T>(
  request: PageRequest,
  rows: (limit: number, offset: number) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<Page<T>> {
  const found = await rows(request.size, pageOffset(request))
  const total = await count()
  return { rows: found, total: Number(total), page: request.page, size: request.size }
}

/**
 * A register's total over one table: the rows its `where` matches, under the
 * same RLS as the page, because it runs in the same `withActor` transaction.
 *
 * Pass the *same* `where` the page query uses, built once. A register whose
 * filter joins another table counts with its own statement instead, carrying
 * the joins the filter needs (`listJobs`).
 */
export async function countRows(tx: Tx, table: PgTable, where?: SQL): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(where)
  return row?.n ?? 0
}

/**
 * A register URL for another page, keeping every filter the current one has.
 *
 * Page one is the bare URL, so the first page of a register is the same
 * address the sidebar links to and bookmarks do not split in two. Empty values
 * are dropped for the same reason the search box drops them.
 */
export function pageHref(
  path: string,
  params: Readonly<Record<string, string | undefined>>,
  page: number,
  /**
   * The query parameter this list pages by. `page` for a screen's main
   * register; a second list on the same screen (the open supplier payments
   * under the bills) takes its own, so paging one leaves the other where it is.
   */
  param = 'page',
): string {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (name === param || value === undefined || value === '') continue
    query.set(name, value)
  }
  if (page > 1) query.set(param, String(page))
  const text = query.toString()
  return text ? `${path}?${text}` : path
}
