/**
 * Asserting on row-level security, which fails in two different ways.
 *
 * This distinction cost the first run of the negative matrix fourteen failures,
 * every one of them the test being wrong rather than the policy, and it is
 * worth stating precisely because it is the thing that makes RLS tests
 * misleading when written by hand:
 *
 * **A write that would create or move a row into a place the actor cannot
 * reach raises.** `WITH CHECK` is evaluated against the *new* row, and a
 * violation is an error — `42501`, "new row violates row-level security
 * policy". Inserting into another branch, or re-pointing your own job at one,
 * both land here.
 *
 * **A write against a row the actor cannot see does not raise.** `USING`
 * decides which rows are even candidates, so an `UPDATE` matching none of them
 * is a statement that updated nothing. No error, `rowCount` zero. Postgres is
 * behaving exactly as documented, and a test that expects an exception here
 * fails while the policy is working perfectly.
 *
 * The second case is also *why* FR-ID-04 reads the way it does — another
 * branch's row is **not found**, not forbidden. An error would be an
 * enumeration signal; silence is the requirement.
 */

import { expect } from 'vitest'

/**
 * Drizzle wraps driver errors, so `error.message` is `Failed query: ...` and
 * the Postgres detail is on `cause`. Matching the top-level message alone
 * silently passes for *any* failed query — including a typo in the fixture —
 * which is worse than not asserting at all.
 */
function pgError(error: unknown): { code?: string; message: string } {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof candidate.code === 'string') {
      return { code: candidate.code, message: String(candidate.message ?? '') }
    }
    current = candidate.cause
  }

  return { message: error instanceof Error ? error.message : String(error) }
}

/**
 * The write raised because the *new* row was not permitted.
 *
 * `42501` is `insufficient_privilege`, which is what a `WITH CHECK` violation
 * reports. Asserting the code rather than the English means the test does not
 * break on a Postgres release that rewords the message, and does not pass on a
 * completely unrelated failure.
 */
export async function expectRlsViolation(work: Promise<unknown>): Promise<void> {
  let raised: unknown

  try {
    await work
  } catch (error) {
    raised = error
  }

  expect(raised, 'the write was permitted — expected a row-level security violation').toBeDefined()

  const { code, message } = pgError(raised)
  expect(
    code === '42501' || /row-level security/i.test(message),
    `expected a row-level security violation, got ${code ?? 'no code'}: ${message}`,
  ).toBe(true)
}

/**
 * The write touched nothing, because no row was visible to touch.
 *
 * Asserted on `rowCount` rather than by reading the row back, so the assertion
 * names what happened — "this statement affected no rows" — instead of
 * inferring it from a value that could have been unchanged for another reason.
 */
export function expectNoRowsAffected(result: { rowCount?: number | null }, because: string): void {
  expect(result.rowCount ?? 0, because).toBe(0)
}
