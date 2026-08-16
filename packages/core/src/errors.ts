/**
 * Domain errors.
 *
 * `core` throws; it never logs, formats for a user, or maps to HTTP. Callers
 * translate. Every error carries a stable `code` so the web layer can look up a
 * bilingual message (§11) rather than render an English string from here.
 */

export class DomainError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/** Arithmetic across two currencies without an explicit conversion. */
export class CurrencyMismatchError extends DomainError {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super('currency_mismatch', `Cannot combine ${left} and ${right} without an explicit conversion`)
  }
}

/** A currency the caller has not supplied a specification for. */
export class UnknownCurrencyError extends DomainError {
  constructor(readonly currency: string) {
    super('unknown_currency', `No specification for currency ${currency}`)
  }
}

/** A state transition the machine in `states.ts` does not allow. */
export class IllegalTransitionError extends DomainError {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super('illegal_transition', `${machine}: ${from} -> ${to} is not an allowed transition`)
  }
}

/** A charge line whose basis needs context the caller did not provide. */
export class MissingChargeContextError extends DomainError {
  constructor(
    readonly basis: string,
    readonly field: string,
  ) {
    super('missing_charge_context', `Basis "${basis}" requires context field "${field}"`)
  }
}

export class InvalidCalendarError extends DomainError {
  constructor(message: string) {
    super('invalid_calendar', message)
  }
}
