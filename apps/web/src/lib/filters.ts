import 'server-only'

/**
 * Register filters that arrive from the query string.
 *
 * `searchParams` is `Record<string, string | undefined>` and nothing narrows it,
 * so a register page that forwards `filters.status` straight into a `where`
 * clause is handing an arbitrary string to a Postgres enum comparison. The
 * casts these replace — `filters.status as 'received'` — told the compiler
 * otherwise, which is why it never complained: the type was asserted, not
 * checked.
 *
 * What that cost: `/payables?status=xyz` reached the database as
 * `invalid input value for enum supplier_invoice_status: "xyz"`, and a hand-typed
 * address became a 500 with a stack trace in the logs. The same shape applies to
 * `?partner=abc` against a `uuid` column — `invalid input syntax for type uuid`.
 * Neither is injection; Drizzle parameterises. Both are an unhandled error on
 * input a stranger controls.
 *
 * A filter the register cannot honour becomes *no filter* rather than an error.
 * That is the behaviour a URL already implies: an unknown status is not a
 * request for the empty set, it is a request nobody can satisfy, and the useful
 * answer is the unfiltered register rather than a crash.
 */

/**
 * Narrow a query-string value to one of an enum's own members.
 *
 * Takes the values from the `pgEnum` itself — `supplierInvoiceStatusEnum.enumValues`
 * — so there is one list, in the schema, and a status added there needs no edit
 * here.
 */
export function enumFilter<const T extends readonly string[]>(
  values: T,
  value: string | undefined,
): T[number] | undefined {
  if (value === undefined) return undefined
  return (values as readonly string[]).includes(value) ? (value as T[number]) : undefined
}

/*
  Shape only, deliberately.

  This is not asking whether the row exists — RLS answers that, and a well-formed
  id for a partner in another branch must return nothing rather than an error.
  It is asking whether Postgres can parse the literal at all, which is the only
  part that throws before any policy runs.
*/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A query-string value that is at least shaped like a `uuid`, or nothing. */
export function uuidFilter(value: string | undefined): string | undefined {
  return value !== undefined && UUID.test(value) ? value : undefined
}
