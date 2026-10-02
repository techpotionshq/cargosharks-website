/**
 * The contract between a server action and a form.
 *
 * Every mutation in the application returns this shape, so a change here
 * changes 47 call sites at once. The two properties that are easy to break and
 * expensive to notice are pinned first: `ok` must change on every success, and
 * `echo` must return what was typed without inventing or dropping anything.
 */

import { describe, expect, it } from 'vitest'
import {
  databaseMessage,
  echo,
  fail,
  failWith,
  fieldErrors,
  isForeignKeyViolation,
  isUniqueViolation,
  succeed,
  type ActionState,
} from './form-state'

describe('succeed', () => {
  /**
   * The reason `ok` is a token and not a boolean. A dialog closes when `ok`
   * *changes*; a boolean stays `true` after the first save, and the second
   * would leave the dialog open over a record that saved fine.
   */
  it('returns a different token for two identical successes', () => {
    const first = succeed('QUO-2026-00001')
    const second = succeed('QUO-2026-00001')
    expect(first.ok).not.toBe(second.ok)
  })

  it('keeps the caller token as the prefix', () => {
    expect(succeed('QUO-2026-00001').ok).toMatch(/^QUO-2026-00001:/)
  })

  it('defaults to a token rather than an empty string', () => {
    expect(succeed().ok).toMatch(/^ok:/)
  })

  it('carries no errors, message or values', () => {
    const state = succeed('x')
    expect(state.errors).toBeUndefined()
    expect(state.message).toBeUndefined()
    expect(state.values).toBeUndefined()
  })

  /** Strictly increasing, so the dialog can never see a token it saw before. */
  it('never repeats a token across many successes', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => succeed('same').ok))
    expect(tokens.size).toBe(500)
  })
})

describe('echo', () => {
  it('returns every string field that was submitted', () => {
    const form = new FormData()
    form.set('totalSell', '1200.500')
    form.set('currency', 'KWD')
    expect(echo(form)).toEqual({ totalSell: '1200.500', currency: 'KWD' })
  })

  it('preserves an amount exactly, without reformatting it', () => {
    const form = new FormData()
    form.set('amount', '0.001')
    form.set('padded', '25000.000000')
    expect(echo(form)).toEqual({ amount: '0.001', padded: '25000.000000' })
  })

  it('keeps empty strings, so a cleared field stays cleared', () => {
    const form = new FormData()
    form.set('notes', '')
    expect(echo(form)).toEqual({ notes: '' })
  })

  /** A file has no place in a re-rendered text input. */
  it('drops non-string entries', () => {
    const form = new FormData()
    form.set('document', new File(['x'], 'bill.pdf'))
    form.set('kind', 'house_bill')
    expect(echo(form)).toEqual({ kind: 'house_bill' })
  })

  /** QA P1-3: a rejected invitation kept only the last ticked branch. */
  it('keeps every value of a name submitted more than once', () => {
    const form = new FormData()
    form.append('branchIds', 'a')
    form.append('branchIds', 'b')
    expect(echo(form)).toEqual({ branchIds: 'a\nb' })
  })

  it('returns an empty object for an empty form', () => {
    expect(echo(new FormData())).toEqual({})
  })

  /**
   * `echo` copies *everything* submitted, so any form carrying a secret would
   * send it back to the client in the action's return value. Nothing does
   * today — the password fields live only in the auth forms, and
   * `features/auth/actions.ts` returns its fields explicitly and never calls
   * `echo`. This test states the hazard so that wiring a password field into
   * an `echo`-using action is a decision rather than an accident.
   */
  it('would echo a secret if one were ever submitted — do not submit one', () => {
    const form = new FormData()
    form.set('password', 'hunter2')
    expect(echo(form).password).toBe('hunter2')
  })
})

describe('fieldErrors', () => {
  it('keys each message onto its own field', () => {
    const flattened = fieldErrors({
      issues: [
        { path: ['totalSell'], message: 'Enter the price you are quoting' },
        { path: ['validUntil'], message: 'A quotation needs an expiry date' },
      ],
    })
    expect(flattened).toEqual({
      totalSell: 'Enter the price you are quoting',
      validUntil: 'A quotation needs an expiry date',
    })
  })

  /** First message wins: one field says one thing, not three. */
  it('keeps the first message for a field with several failures', () => {
    const flattened = fieldErrors({
      issues: [
        { path: ['amount'], message: 'Amount must be a number' },
        { path: ['amount'], message: 'Amount is required' },
      ],
    })
    expect(flattened).toEqual({ amount: 'Amount must be a number' })
  })

  /** A whole-object refinement has no path; it belongs under `_`. */
  it('files a pathless issue under underscore', () => {
    expect(fieldErrors({ issues: [{ path: [], message: 'Nothing to update.' }] })).toEqual({
      _: 'Nothing to update.',
    })
  })

  it('uses only the first path segment, so a nested field lands on its root', () => {
    expect(fieldErrors({ issues: [{ path: ['lines', 0, 'rate'], message: 'Bad rate' }] })).toEqual({
      lines: 'Bad rate',
    })
  })

  it('returns an empty object when nothing failed', () => {
    expect(fieldErrors({ issues: [] })).toEqual({})
  })
})

describe('fail and failWith', () => {
  it('carries field errors and the echoed values', () => {
    const state: ActionState = fail({ amount: 'Too much' }, { amount: '999' })
    expect(state.errors).toEqual({ amount: 'Too much' })
    expect(state.values).toEqual({ amount: '999' })
    expect(state.ok).toBeUndefined()
  })

  it('carries a form-level message with no field', () => {
    const state = failWith('That invoice cannot move to that state from where it is.')
    expect(state.message).toContain('cannot move')
    expect(state.errors).toBeUndefined()
    expect(state.ok).toBeUndefined()
  })

  /** A failure must never look like a success to the dialog. */
  it('never sets ok', () => {
    expect(fail({ a: 'b' }).ok).toBeUndefined()
    expect(failWith('x').ok).toBeUndefined()
  })
})

describe('PostgreSQL error classification', () => {
  it('recognises a unique violation', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
  })

  it('recognises a foreign-key violation', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true)
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false)
  })

  /**
   * The shape these actually arrive in, and the reason this file changed.
   *
   * Drizzle wraps the driver's error in a `DrizzleQueryError` that carries no
   * `code` of its own and whose message is the query text. Reading `code` off
   * the top-level object found nothing, so every friendly constraint message
   * in the application was dead and the user got a 500 on the one path they
   * are most likely to take twice — submitting a form with a value somebody
   * already used.
   */
  it('sees through the wrapper Drizzle actually throws', () => {
    const wrapped = Object.assign(new Error('Failed query: insert into "customers" …'), {
      cause: Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    })
    expect(isUniqueViolation(wrapped)).toBe(true)
    expect(isForeignKeyViolation(wrapped)).toBe(false)
  })

  it('finds a code nested more than one layer down', () => {
    const deep = { cause: { cause: { code: '23503' } } }
    expect(isForeignKeyViolation(deep)).toBe(true)
  })

  /** A Node error code is not a SQLSTATE, however much it looks like one. */
  it('does not mistake a Node error code for a SQLSTATE', () => {
    expect(isUniqueViolation({ code: 'ENOENT' })).toBe(false)
    expect(isForeignKeyViolation({ code: 'ECONNREFUSED' })).toBe(false)
  })

  it('terminates on a cause cycle rather than hanging', () => {
    const a: { cause?: unknown } = {}
    a.cause = a
    expect(isUniqueViolation(a)).toBe(false)
    expect(databaseMessage(a)).toBe('')
  })

  describe('databaseMessage', () => {
    /**
     * Some checks match on what the database *said* — a named constraint, or a
     * trigger raising its own sentence. The wrapper's message is the query
     * text, so matching on it alone never sees those words.
     */
    it('reaches the message the database actually produced', () => {
      const wrapped = Object.assign(new Error('Failed query: insert into "job_parties" …'), {
        cause: new Error(
          'duplicate key value violates unique constraint "job_parties_single_principal"',
        ),
      })
      expect(databaseMessage(wrapped)).toContain('job_parties_single_principal')
    })

    it('keeps the outer message too', () => {
      const wrapped = Object.assign(new Error('Failed query: outer'), {
        cause: new Error('inner detail'),
      })
      expect(databaseMessage(wrapped)).toContain('Failed query: outer')
      expect(databaseMessage(wrapped)).toContain('inner detail')
    })

    it('is empty for a value that carries no message', () => {
      expect(databaseMessage(null)).toBe('')
      expect(databaseMessage(undefined)).toBe('')
      expect(databaseMessage(42)).toBe('')
    })
  })

  /** Anything that is not a pg error must not be mistaken for one. */
  it.each([null, undefined, 'boom', 42, new Error('boom'), {}])(
    'does not classify %s as a constraint violation',
    (value) => {
      expect(isUniqueViolation(value)).toBe(false)
      expect(isForeignKeyViolation(value)).toBe(false)
    },
  )
})
