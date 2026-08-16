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
}

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

/** Everything the user typed, so a rejected form can be re-rendered intact. */
export function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export function fail(
  errors: Record<string, string>,
  values?: Record<string, string>,
): ActionState {
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
 * PostgreSQL's unique-violation code.
 *
 * Caught rather than pre-checked: a `select` before an `insert` is a race, and
 * the database is already enforcing the constraint correctly. The only thing
 * left to do is turn `23505` into a sentence next to the field.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

/** A foreign key that does not resolve — usually a stale option in a select. */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23503'
  )
}
