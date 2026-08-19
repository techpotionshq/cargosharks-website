import { describe, expect, it } from 'vitest'
import {
  abs,
  add,
  applyMinimum,
  compare,
  convert,
  CurrencyMismatchError,
  divide,
  equals,
  formatMoney,
  fromDb,
  fxRate,
  identityRate,
  isNegative,
  isZero,
  max,
  min,
  money,
  multiply,
  negate,
  percentOf,
  round,
  seedCurrencyLookup,
  roundWith,
  subtract,
  sum,
  toDb,
  toScale,
  UnknownCurrencyError,
  zero,
} from '../src/index'

const KWD = seedCurrencyLookup('KWD')!
const USD = seedCurrencyLookup('USD')!

describe('rounding is per currency, at the line (NFR-02)', () => {
  it('keeps three decimals for KWD', () => {
    expect(round(money('12.3456', 'KWD'), KWD).amount.toFixed()).toBe('12.346')
  })

  it('keeps two for USD', () => {
    expect(round(money('12.345', 'USD'), USD).amount.toFixed()).toBe('12.35')
  })

  it('does not lose the third decimal when a KWD total is summed', () => {
    // Three lines at 0.335 KWD: rounding each line then summing must equal
    // 1.005, not the 1.01 a two-decimal system would produce.
    const lines = ['0.335', '0.335', '0.335'].map((a) =>
      roundWith(money(a, 'KWD'), seedCurrencyLookup),
    )
    expect(toDb(sum(lines, 'KWD'))).toBe('1.005')
  })
})

describe('currency safety', () => {
  it('refuses to add across currencies', () => {
    expect(() => add(money(1, 'KWD'), money(1, 'USD'))).toThrow(CurrencyMismatchError)
  })

  it('sums an empty list into a currency-bearing zero', () => {
    expect(sum([], 'KWD')).toEqual(zero('KWD'))
  })
})

describe('FX travels with the line (FR-RT-06)', () => {
  it('reconciles a March quote against a June invoice using the stored rate', () => {
    const marchRate = fxRate('USD', 'KWD', '0.30650', new Date('2026-03-04T09:00:00Z'))
    const quoted = money('4250.00', 'USD')

    const invoiced = roundWith(convert(quoted, marchRate), seedCurrencyLookup)

    // Months later the spot rate has moved; the line still reconciles because
    // the rate used is the one stamped on it, not today's.
    expect(toDb(invoiced)).toBe('1302.625')
    expect(marchRate.takenAt.toISOString()).toBe('2026-03-04T09:00:00.000Z')
  })
})

describe('percentages', () => {
  it('treats 12.5 as 12.5 per cent', () => {
    expect(toDb(percentOf(money('200', 'USD'), '12.5'))).toBe('25')
  })
})

describe('comparison, and the minimum charge', () => {
  it('picks the larger and the smaller of two amounts', () => {
    const small = money('10.000', 'KWD')
    const large = money('99.000', 'KWD')

    expect(max(small, large)).toBe(large)
    expect(max(large, small)).toBe(large)
    expect(min(small, large)).toBe(small)
    expect(min(large, small)).toBe(small)
  })

  it('refuses to compare across currencies rather than picking one', () => {
    expect(() => max(money(1, 'KWD'), money(1, 'USD'))).toThrow(CurrencyMismatchError)
    expect(() => compare(money(1, 'KWD'), money(1, 'USD'))).toThrow(CurrencyMismatchError)
  })

  it('answers equal only when the currency agrees too', () => {
    expect(equals(money('5.000', 'KWD'), money('5.000', 'KWD'))).toBe(true)
    // Not a comparison error: two different currencies are simply not equal,
    // which is what a caller asking "is this the same amount" needs to hear.
    expect(equals(money('5.00', 'USD'), money('5.000', 'KWD'))).toBe(false)
  })

  /**
   * FR-RT-05. A rated line below the floor is charged the floor; one above it
   * is left alone; a charge type with no floor configured is not raised to
   * anything, which is the arm that would otherwise quietly invent a minimum.
   */
  describe('the minimum charge', () => {
    it('raises a line that came out under the floor', () => {
      expect(toDb(applyMinimum(money('12.000', 'KWD'), money('25.000', 'KWD')))).toBe('25')
    })

    it('leaves a line that already clears it', () => {
      expect(toDb(applyMinimum(money('80.000', 'KWD'), money('25.000', 'KWD')))).toBe('80')
    })

    it('changes nothing where no minimum is configured', () => {
      expect(toDb(applyMinimum(money('12.000', 'KWD'), null))).toBe('12')
      expect(toDb(applyMinimum(money('12.000', 'KWD'), undefined))).toBe('12')
    })
  })
})

describe('the rounding mode is a property of the currency', () => {
  /**
   * Half-up is the default because it is what an invoice reader expects. The
   * others exist because a deployment can configure them per currency
   * (FR-AD-03), and a mode that is accepted but ignored is worse than one that
   * is refused.
   */
  it('honours the mode the currency was configured with', () => {
    const amount = money('12.3455', 'KWD')

    expect(round(amount, { code: 'KWD', minorUnits: 3 }).amount.toFixed()).toBe('12.346')
    expect(
      round(amount, { code: 'KWD', minorUnits: 3, rounding: 'half_even' }).amount.toFixed(),
    ).toBe('12.346')
    expect(round(amount, { code: 'KWD', minorUnits: 3, rounding: 'up' }).amount.toFixed()).toBe(
      '12.346',
    )
    expect(round(amount, { code: 'KWD', minorUnits: 3, rounding: 'down' }).amount.toFixed()).toBe(
      '12.345',
    )
  })

  /** Half-even breaks a tie toward the even digit; half-up always away. */
  it('separates half-even from half-up on an exact tie', () => {
    const tie = money('0.125', 'USD')

    expect(round(tie, { code: 'USD', minorUnits: 2 }).amount.toFixed()).toBe('0.13')
    expect(round(tie, { code: 'USD', minorUnits: 2, rounding: 'half_even' }).amount.toFixed()).toBe(
      '0.12',
    )
  })

  /**
   * A specification for the wrong currency is a bug, not a conversion. Two
   * decimals applied to a KWD line drops a fils on every row of the invoice.
   */
  it('refuses a specification for another currency', () => {
    expect(() => round(money('1.000', 'KWD'), USD)).toThrow(CurrencyMismatchError)
  })

  it('refuses a currency the deployment never described', () => {
    expect(() => roundWith(money('1.00', 'XYZ'), seedCurrencyLookup)).toThrow(UnknownCurrencyError)
  })
})

describe('conversion', () => {
  it('refuses a rate that was not taken from this line’s currency', () => {
    const rate = fxRate('EUR', 'KWD', '0.33', new Date('2026-03-04T09:00:00Z'))

    expect(() => convert(money('100.00', 'USD'), rate)).toThrow(CurrencyMismatchError)
  })

  /** So a KWD line carries a rate like every other line, rather than a null. */
  it('gives a same-currency line the identity rate', () => {
    const at = new Date('2026-03-04T09:00:00Z')
    const rate = identityRate('KWD', at)

    expect(rate.rate.toFixed()).toBe('1')
    expect(rate.takenAt).toBe(at)
    expect(toDb(convert(money('380.000', 'KWD'), rate))).toBe('380')
  })
})

describe('the wire and the page', () => {
  it('reads a null numeric as zero rather than NaN', () => {
    expect(toDb(fromDb(null, 'KWD'))).toBe('0')
    expect(toDb(fromDb(undefined, 'KWD'))).toBe('0')
    expect(toDb(fromDb('380.000000', 'KWD'))).toBe('380')
  })

  /**
   * The trailing zeros are the whole point. `toDb` gives `380` — right for a
   * `numeric` column, wrong in a letter to a customer holding an invoice that
   * reads `380.000`, because a figure that has quietly dropped its fils looks
   * like a different number. `numeric(19,6)` coming back as `500.000000` is
   * the same mistake from the other side.
   */
  it('states an amount at the currency’s own precision, zeros and all', () => {
    expect(toScale(money('380', 'KWD'))).toBe('380.000')
    expect(toScale(money('500.000000', 'KWD'))).toBe('500.000')
    expect(toScale(money('380', 'USD'))).toBe('380.00')
    // Rounded on the way out, so a stored six-decimal value cannot print a
    // fourth decimal into a notification.
    expect(toScale(money('12.3456', 'KWD'))).toBe('12.346')
  })

  it('refuses to state an amount in a currency it cannot describe', () => {
    expect(() => toScale(money('1', 'XYZ'))).toThrow(UnknownCurrencyError)
  })

  it('takes a lookup of the deployment’s own currencies', () => {
    const lookup = (code: string) => (code === 'XYZ' ? { code, minorUnits: 4 } : undefined)

    expect(toScale(money('1.5', 'XYZ'), lookup)).toBe('1.5000')
  })

  /** Presentation only — the web layer formats through `next-intl`. */
  it('formats for a reader in either language', () => {
    const en = formatMoney(money('1234.5', 'KWD'), KWD, 'en')
    const ar = formatMoney(money('1234.5', 'KWD'), KWD, 'ar')

    expect(en).toContain('1,234.500')
    expect(en).not.toBe(ar)
    // English is the default, so a caller that forgets the argument does not
    // silently get the other language.
    expect(formatMoney(money('1234.5', 'KWD'), KWD)).toBe(en)
  })
})

describe('the rest of the arithmetic', () => {
  it('subtracts, multiplies and divides without leaving the currency', () => {
    expect(toDb(subtract(money('100.000', 'KWD'), money('40.500', 'KWD')))).toBe('59.5')
    expect(toDb(multiply(money('12.500', 'KWD'), 4))).toBe('50')
    expect(toDb(divide(money('100.000', 'KWD'), 8))).toBe('12.5')
    expect(divide(money('100.000', 'KWD'), 8).currency).toBe('KWD')
  })

  it('refuses to subtract across currencies', () => {
    expect(() => subtract(money(1, 'KWD'), money(1, 'USD'))).toThrow(CurrencyMismatchError)
  })

  /** A credit note is a negative line, not a separate kind of number. */
  it('negates and takes the absolute value', () => {
    expect(toDb(negate(money('42.000', 'KWD')))).toBe('-42')
    expect(toDb(abs(money('-42.000', 'KWD')))).toBe('42')
    expect(isNegative(negate(money('42.000', 'KWD')))).toBe(true)
    expect(isNegative(money('42.000', 'KWD'))).toBe(false)
  })

  it('answers whether an amount is nothing', () => {
    expect(isZero(zero('KWD'))).toBe(true)
    expect(isZero(money('0.000', 'KWD'))).toBe(true)
    // A tenth of a fils is not nothing — it is the residue an allocation has
    // to place somewhere, and rounding it away is how a payment stops
    // reconciling.
    expect(isZero(money('0.000001', 'KWD'))).toBe(false)
  })
})
