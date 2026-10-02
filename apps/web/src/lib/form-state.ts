/**
 * The contract between a server action and a form.
 *
 * Every mutation in the application returns this shape, and it is worth being
 * strict about that: the alternative — each slice inventing its own — is what
 * makes a codebase where one form loses your input on a validation failure and
 * the one beside it does not.
 *
 * `ok` is a *token*, not a boolean, and that detail is load-bearing. A dialog
 * closes when `ok` changes, so two consecutive successful submissions both
 * close it. A boolean would stay `true` after the first and the second would
 * leave the dialog sitting open over a saved record.
 */

export interface ActionState {
  /** Field-keyed messages, so each input renders its own. */
  readonly errors?: Record<string, string>
  /** A failure no single field owns — a conflict, a permission, a timeout. */
  readonly message?: string
  /** Changes on success. Consumed by `Modal`'s `closeOn`. */
  readonly ok?: string
  /** Echoed back so a rejected form does not lose what was typed. */
  readonly values?: Record<string, string>
  /**
   * Where the failure points, when it points somewhere — "this bill is already
   * captured" is only half an answer without the way to it (ai-10).
   */
  readonly link?: { readonly href: string; readonly label: string }
}

/**
 * A bound `next-intl` translator, as a schema factory receives it.
 *
 * Validation messages reach the operator verbatim, so they are catalogue keys
 * like every other string — which means a schema that carries messages is built
 * per request from `await getTranslations(…)` rather than once at module load,
 * where no locale exists yet. Structural rather than `next-intl`'s own type so
 * a test's stand-in translator satisfies it too.
 *
 * The type argument is the namespace, and it is for `check-messages` rather
 * than the compiler: a schema file that never calls `getTranslations` itself
 * types its translator parameter with the namespace name as the argument, and
 * the check resolves that parameter's calls against it. Without it such a file
 * is skipped. (Written without an example on purpose — the check reads
 * comments too.)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter is read by scripts/check-messages.mjs
export type Translate<Namespace extends string = string> = (
  key: string,
  values?: Record<string, string | number>,
) => string

/** Zod's issues, flattened onto the field each one belongs to. */
export function fieldErrors(error: {
  issues: { path: PropertyKey[]; message: string }[]
}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_')
    // First message wins: a field with three failing rules should say one
    // thing, and the first is the most specific Zod produced.
    out[key] ??= issue.message
  }
  return out
}

/**
 * Everything the user typed, so a rejected form can be re-rendered intact.
 *
 * A name submitted more than once — a group of switches — comes back as its
 * values joined by newlines. Last-one-wins re-rendered a rejected invitation
 * with only the last ticked branch still ticked. A newline because no value a
 * grouped control submits (an id, a code) can contain one.
 */
export function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue
    out[key] = key in out ? `${out[key]}\n${value}` : value
  }
  return out
}

export function fail(errors: Record<string, string>, values?: Record<string, string>): ActionState {
  return { errors, values }
}

export function failWith(message: string, values?: Record<string, string>): ActionState {
  return { message, values }
}

/**
 * A success, tokenised.
 *
 * The token is whatever identifies what just happened — a reference, an id.
 * It is suffixed with a counter so that saving the *same* record twice still
 * produces a changed value, which is what the dialog watches.
 */
let sequence = 0
export function succeed(token = 'ok'): ActionState {
  sequence += 1
  return { ok: `${token}:${sequence}` }
}

/**
 * The SQLSTATE of a database error, wherever it is buried.
 *
 * Drizzle does not rethrow the driver's error — it wraps it in a
 * `DrizzleQueryError` whose own message is `Failed query: insert into …` and
 * which carries **no `code` of its own**. The pg error, with the SQLSTATE on
 * it, is at `.cause`.
 *
 * That detail quietly disabled every friendly constraint message in the
 * application. `isUniqueViolation` read `code` off the top-level object, found
 * nothing, returned false, and the action rethrew — so "Someone already has
 * that email address" became an unhandled 500 with a Postgres constraint name
 * in the log. The check looked right, the constraint worked, and the only
 * symptom was the interface breaking on the one path a user is most likely to
 * take twice.
 *
 * Walking the chain rather than reaching for `.cause` once: the wrapper is
 * Drizzle's today and nothing guarantees it stays one layer deep.
 */
function sqlState(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code?: unknown }).code
      // SQLSTATE is five characters. Node's own errors use names like ENOENT.
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    }
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * Every message in the chain, for the checks that match on what the database
 * *said* rather than on a code — a named constraint, or a trigger that raises
 * its own sentence. The wrapper's message is the query text, so matching on it
 * alone never sees the trigger's words.
 */
export function databaseMessage(error: unknown): string {
  const parts: string[] = []
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current === 'object' && 'message' in current) {
      const message = (current as { message?: unknown }).message
      if (typeof message === 'string') parts.push(message)
    }
    current = (current as { cause?: unknown }).cause
  }
  return parts.join('\n')
}

/**
 * PostgreSQL's unique-violation code.
 *
 * Caught rather than pre-checked: a `select` before an `insert` is a race, and
 * the database is already enforcing the constraint correctly. The only thing
 * left to do is turn `23505` into a sentence next to the field.
 */
export function isUniqueViolation(error: unknown): boolean {
  return sqlState(error) === '23505'
}

/** A foreign key that does not resolve — usually a stale option in a select. */
export function isForeignKeyViolation(error: unknown): boolean {
  return sqlState(error) === '23503'
}

/**
 * An exclusion or temporal-uniqueness violation — `rate_cards_no_overlap`,
 * the `WITHOUT OVERLAPS` key that refuses two cards for one lane and window.
 */
export function isOverlapViolation(error: unknown): boolean {
  return sqlState(error) === '23P01'
}
