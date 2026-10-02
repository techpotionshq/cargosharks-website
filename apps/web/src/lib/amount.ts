/**
 * An amount as somebody typed it, in the form the schemas check — QA P3.
 *
 * Money is validated as text against `^\d+(\.\d{1,6})?$` and never coerced to
 * a float (see `costing/form-actions.ts`). That rule is right and was applied
 * to the raw keystrokes, so "1,200.500" — how every invoice in this business
 * prints it — was refused with "enter a number", and so was "١٢٠٠٫٥" typed on
 * an Arabic keyboard. Both are unambiguous, so they are accepted:
 *
 *   - Arabic-Indic and Extended Arabic-Indic digits become ASCII digits.
 *   - The Arabic decimal separator (٫) becomes a point.
 *   - Thousands separators — a comma, the Arabic thousands sign (٬), a space,
 *     a no-break or thin space — are dropped, but only where they sit in
 *     groups of three before the decimal point. "1,2,3" or "1200,5" (a comma
 *     as the decimal mark) are left as typed, for the schema to refuse rather
 *     than for this to guess.
 *
 * Anything else is returned unchanged, so the schema's own message still
 * speaks for it. Pure, and in `lib` rather than a slice: every money form uses
 * it, through `.overwrite(normaliseAmount)` after `.trim()`.
 */

const ARABIC_INDIC = /[٠-٩]/g
const EXTENDED_ARABIC_INDIC = /[۰-۹]/g

/** The separators a person groups thousands with. */
const GROUP = /[,٬   ]/

export function normaliseAmount(value: string): string {
  const digits = value
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .trim()

  if (!GROUP.test(digits)) return digits

  // One separator kind, in groups of three, then an optional decimal part.
  const grouped = /^(-?)(\d{1,3})((?:([,٬   ])\d{3})(?:\4\d{3})*)(\.\d+)?$/.exec(digits)
  if (!grouped) return digits
  const [, sign, head, groups, , fraction] = grouped
  return `${sign}${head}${groups!.replace(/[^\d]/g, '')}${fraction ?? ''}`
}
