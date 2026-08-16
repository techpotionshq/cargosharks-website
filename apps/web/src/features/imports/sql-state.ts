/**
 * The SQLSTATE, wherever the driver stack happens to have put it.
 *
 * Its own module rather than a helper inside `actions.ts` so it can be tested
 * without importing a `'use server'` file and, through it, the session.
 *
 * Drizzle wraps a driver failure in its own `Error` and hangs the `pg` error
 * off `cause`, so the `code` a caller reaches for is `undefined` on the object
 * it is handed:
 *
 *     err.code             -> undefined
 *     err.cause.code       -> '23P01'
 *     err.cause.constraint -> 'rate_cards_no_overlap'
 *
 * Reading only the top level meant an overlapping tariff — the single most
 * likely rejection the importer can provoke — fell through to `throw` and
 * reached the operator as a 500 instead of the message written for it. That
 * shape is verified against the real constraint in `sql-state.test.ts`.
 *
 * The chain is walked rather than the one known level read, because that is
 * one wrapper's current shape and not a promise. Depth is capped so a
 * self-referential `cause` cannot spin.
 */

/** Five characters, digits and upper-case letters — the SQLSTATE alphabet. */
const SQLSTATE = /^[0-9A-Z]{5}$/

export function sqlState(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (typeof current !== 'object') return undefined
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && SQLSTATE.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * Class 23 — integrity constraint violation, split by what the operator can
 * do about it.
 *
 * `23P01` is the exclusion violation raised by `rate_cards_no_overlap`, the
 * temporal `unique ... without overlaps` from `0002_constraints.sql`. It is
 * not an error in the file: it means this tariff covers a lane and a period
 * that another card already covers, and `FR-RT-08` refuses to let both exist
 * because "the valid rate" would then be ambiguous.
 */
export const CONFLICT_STATES = new Set(['23505', '23P01'])

/** A row pointing at something absent, or a value the column refuses. */
export const REFERENCE_STATES = new Set(['23503', '23514', '22P02'])
