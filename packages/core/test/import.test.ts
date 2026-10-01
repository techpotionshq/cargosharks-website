/**
 * Bulk import — `FR-MD-11`, `FR-RT-09`.
 *
 * The acceptance criteria are testable without any infrastructure, which is
 * the point of keeping the engine in `core`: "a file with errors imports
 * nothing and returns a row-by-row report" is an assertion about a pure
 * function, not about a database.
 *
 * The fixtures are deliberately ugly. Real agent tariffs arrive with currency
 * symbols in the rate column, European decimal commas, Arabic-Indic digits,
 * quoted port names containing commas, blank rows Excel appended, and a
 * heading nobody standardised. A parser tested only on clean input is tested
 * on the one file that will never arrive.
 */

import { describe, expect, it } from 'vitest'
import {
  autoMap,
  boolean,
  cellFail,
  cellOk,
  code,
  decimal,
  detectDelimiter,
  email,
  groupRateCards,
  integer,
  isBlankRow,
  isoDate,
  issuesCsv,
  lookup,
  normaliseDigits,
  oneOf,
  optional,
  parseDelimited,
  phone,
  readImport,
  templateCsv,
  text,
  validateImport,
  withDefault,
  type ImportDescriptor,
  type ImportRow,
  type RateRowValues,
} from '../src/import'

const ctx = { lookups: {} }

/* ---------------------------------------------------------------- parsing */

describe('parseDelimited', () => {
  it('reads a plain comma file', () => {
    expect(parseDelimited('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps a delimiter that sits inside quotes', () => {
    // "Doha, Qatar" is one field. Getting this wrong shifts every later column
    // by one and reports the error against the wrong heading.
    expect(parseDelimited('name,country\n"Doha, Qatar",QA\n')).toEqual([
      ['name', 'country'],
      ['Doha, Qatar', 'QA'],
    ])
  })

  it('unescapes a doubled quote', () => {
    expect(parseDelimited('a\n"He said ""go"""\n')).toEqual([['a'], ['He said "go"']])
  })

  it('keeps a newline inside a quoted field', () => {
    const rows = parseDelimited('code,address\nKW1,"PO Box 22\nSafat, Kuwait"\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]![1]).toBe('PO Box 22\nSafat, Kuwait')
  })

  it('handles CRLF, a BOM, and no trailing newline', () => {
    expect(parseDelimited('﻿a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('preserves empty trailing fields rather than dropping them', () => {
    expect(parseDelimited('a,b,c\n1,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ])
  })

  it('leaves a ragged row ragged', () => {
    // Padding here would hide a real defect in the file.
    expect(parseDelimited('a,b,c\n1\n')).toEqual([['a', 'b', 'c'], ['1']])
  })
})

describe('detectDelimiter', () => {
  it('finds semicolons, which an Arabic or European Excel writes', () => {
    expect(detectDelimiter('code;name;country\nKW1;Kuwait;KW')).toBe(';')
  })

  it('finds tabs, which "Save as Text" writes', () => {
    expect(detectDelimiter('code\tname\nKW1\tKuwait')).toBe('\t')
  })

  it('is not fooled by commas inside a quoted heading', () => {
    expect(detectDelimiter('"Port, of loading";"Rate"')).toBe(';')
  })

  it('defaults to a comma for a single-column file', () => {
    expect(detectDelimiter('code\nKW1')).toBe(',')
  })
})

describe('isBlankRow', () => {
  it('treats a row of empty strings and whitespace as blank', () => {
    expect(isBlankRow(['', '  ', ''])).toBe(true)
    expect(isBlankRow(['', 'x'])).toBe(false)
  })
})

/* ------------------------------------------------------------------ cells */

describe('decimal', () => {
  const parse = decimal()

  it('accepts a plain amount', () => {
    expect(parse('850.00', ctx)).toEqual({ ok: true, value: '850.00' })
  })

  it('strips a currency symbol and thousands separators', () => {
    expect(parse('$ 1,250.75', ctx)).toEqual({ ok: true, value: '1250.75' })
    expect(parse('USD 2,000', ctx)).toEqual({ ok: true, value: '2000' })
  })

  it('reads a European decimal comma as a decimal point', () => {
    // `1,5` is one and a half; `1,200` is one thousand two hundred. The rule
    // is positional and it has to get both right from the same column.
    expect(parse('1,5', ctx)).toEqual({ ok: true, value: '1.5' })
    expect(parse('1,200', ctx)).toEqual({ ok: true, value: '1200' })
    expect(parse('1.234,56', ctx)).toEqual({ ok: true, value: '1234.56' })
    expect(parse('1,234.56', ctx)).toEqual({ ok: true, value: '1234.56' })
  })

  it('reads Arabic-Indic digits', () => {
    expect(parse('٨٥٠٫٥'.replace('٫', '.'), ctx)).toEqual({ ok: true, value: '850.5' })
    expect(parse('١٢٣', ctx)).toEqual({ ok: true, value: '123' })
  })

  it('rejects a negative by default and accepts one when allowed', () => {
    expect(parse('(1,200.50)', ctx)).toEqual({
      ok: false,
      code: 'negative',
      message: 'Must not be negative',
    })
    expect(decimal({ allowNegative: true })('(1,200.50)', ctx)).toEqual({
      ok: true,
      value: '-1200.50',
    })
    expect(decimal({ allowNegative: true })('150-', ctx)).toEqual({ ok: true, value: '-150' })
  })

  it('rejects text, blanks and excess precision', () => {
    expect(parse('on request', ctx).ok).toBe(false)
    expect(parse('', ctx)).toEqual({ ok: false, code: 'required', message: 'Required' })
    expect(parse('1.1234567', ctx)).toEqual({
      ok: false,
      code: 'tooManyDecimals',
      message: 'At most six decimal places',
    })
  })

  it('never returns a JS number, so numeric(19,6) survives the journey', () => {
    const result = parse('0.1', ctx)
    expect(result.ok && typeof result.value).toBe('string')
  })
})

describe('isoDate', () => {
  it('normalises ISO and day-first forms', () => {
    expect(isoDate('2026-03-04', ctx)).toEqual({ ok: true, value: '2026-03-04' })
    expect(isoDate('2026-3-4', ctx)).toEqual({ ok: true, value: '2026-03-04' })
    expect(isoDate('04/03/2026', ctx)).toEqual({ ok: true, value: '2026-03-04' })
    expect(isoDate('04.03.2026', ctx)).toEqual({ ok: true, value: '2026-03-04' })
  })

  it('reads day-first, not month-first', () => {
    // The two are indistinguishable for the first twelve days of a month, so
    // the choice has to be made once and stated. Reading this as 4 March —
    // not 3 April — is what the region writes.
    expect(isoDate('04/03/2026', ctx)).toEqual({ ok: true, value: '2026-03-04' })
  })

  it('rejects a day the month does not have', () => {
    expect(isoDate('31/02/2026', ctx)).toEqual({
      ok: false,
      code: 'dayOutOfRange',
      message: 'That day does not exist',
    })
    expect(isoDate('31/04/2026', ctx).ok).toBe(false)
  })

  it('knows which years February has 29 days in', () => {
    expect(isoDate('29/02/2024', ctx)).toEqual({ ok: true, value: '2024-02-29' })
    expect(isoDate('29/02/2026', ctx).ok).toBe(false)
    expect(isoDate('29/02/2000', ctx).ok).toBe(true) // 400-year rule
    expect(isoDate('29/02/1900', ctx).ok).toBe(false) // 100-year rule
  })

  it('rejects a month above twelve rather than guessing', () => {
    expect(isoDate('13/13/2026', ctx)).toEqual({
      ok: false,
      code: 'monthOutOfRange',
      message: 'Month must be between 1 and 12',
    })
  })
})

describe('boolean', () => {
  const parse = boolean({ default: true })

  it('reads the spellings a sheet actually uses, in both languages', () => {
    for (const yes of ['Y', 'yes', 'TRUE', '1', 'Active', 'نعم']) {
      expect(parse(yes, ctx)).toEqual({ ok: true, value: true })
    }
    for (const no of ['N', 'no', 'FALSE', '0', 'Inactive', 'لا']) {
      expect(parse(no, ctx)).toEqual({ ok: true, value: false })
    }
  })

  it('errors on an unrecognised value rather than defaulting to false', () => {
    // A column of "Suspended" importing silently as inactive would deactivate
    // the customer list without a word.
    expect(parse('Suspended', ctx)).toEqual({
      ok: false,
      code: 'notYesNo',
      message: 'Must be yes or no',
    })
  })

  it('uses the default only for a blank', () => {
    expect(parse('', ctx)).toEqual({ ok: true, value: true })
    expect(boolean()('', ctx)).toEqual({ ok: false, code: 'required', message: 'Required' })
  })
})

describe('oneOf', () => {
  const mode = oneOf(['sea_fcl', 'sea_lcl', 'air', 'land'] as const, {
    fcl: 'sea_fcl',
    lcl: 'sea_lcl',
    ocean: 'sea_fcl',
    airfreight: 'air',
    road: 'land',
  })

  it('matches ignoring case, spaces and separators', () => {
    expect(mode('Sea FCL', ctx)).toEqual({ ok: true, value: 'sea_fcl' })
    expect(mode('sea-fcl', ctx)).toEqual({ ok: true, value: 'sea_fcl' })
  })

  it('accepts the words the trade uses', () => {
    expect(mode('FCL', ctx)).toEqual({ ok: true, value: 'sea_fcl' })
    expect(mode('Road', ctx)).toEqual({ ok: true, value: 'land' })
  })

  it('lists the permitted values when it fails', () => {
    const result = mode('barge', ctx)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.code).toBe('notOneOf')
    // In the values, not only the English: the translated sentence needs them.
    expect(!result.ok && result.values?.options).toContain('sea_fcl')
    expect(!result.ok && result.message).toContain('sea_fcl')
  })
})

describe('lookup', () => {
  const country = lookup('countries', { label: 'country', length: 2 })
  const context = { lookups: { countries: new Set(['KW', 'AE', 'QA']) } }

  it('accepts a known code, uppercased', () => {
    expect(country('kw', context)).toEqual({ ok: true, value: 'KW' })
  })

  it('rejects an unknown code, naming the set so a translation can name the noun', () => {
    expect(country('ZZ', context)).toEqual({
      ok: false,
      code: 'unknownReference',
      values: { set: 'countries', value: 'ZZ' },
      message: 'Not a known country',
    })
  })

  it('rejects the wrong length before consulting the set', () => {
    expect(country('KWT', context)).toEqual({
      ok: false,
      code: 'wrongLength',
      values: { length: 2 },
      message: 'Must be 2 characters',
    })
  })

  it('says so when the reference data was never loaded', () => {
    expect(country('KW', { lookups: {} })).toMatchObject({
      ok: false,
      code: 'noReferenceData',
      values: { set: 'countries' },
    })
  })
})

describe('code, email, phone', () => {
  it('uppercases a code and rejects a space in it', () => {
    expect(code()('kw-01', ctx)).toEqual({ ok: true, value: 'KW-01' })
    expect(code()('KW 01', ctx)).toEqual({
      ok: false,
      code: 'codeCharacters',
      message: 'Letters, numbers and hyphens only',
    })
  })

  it('lowercases an email and rejects an obvious non-address', () => {
    expect(email('Ops@Qabandi.com', ctx)).toEqual({ ok: true, value: 'ops@qabandi.com' })
    expect(email('ops at qabandi', ctx).ok).toBe(false)
    expect(email('ops@qabandi', ctx).ok).toBe(false)
  })

  it('accepts a Gulf phone number in the shapes people write it', () => {
    expect(phone('+965 2222 3333', ctx).ok).toBe(true)
    expect(phone('(965) 2222-3333', ctx).ok).toBe(true)
    expect(phone('call the office', ctx).ok).toBe(false)
  })
})

describe('optional and withDefault', () => {
  it('turns a blank into null, and anything else into a parsed value', () => {
    expect(optional(text())('', ctx)).toEqual({ ok: true, value: null })
    expect(optional(text())(' Kuwait ', ctx)).toEqual({ ok: true, value: 'Kuwait' })
  })

  it('still reports a bad value in an optional column', () => {
    expect(optional(decimal())('abc', ctx).ok).toBe(false)
  })

  it('substitutes a default for a blank only', () => {
    expect(withDefault(decimal(), '0')('', ctx)).toEqual({ ok: true, value: '0' })
    expect(withDefault(decimal(), '0')('12', ctx)).toEqual({ ok: true, value: '12' })
  })
})

describe('normaliseDigits', () => {
  it('converts both Arabic-Indic ranges', () => {
    expect(normaliseDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(normaliseDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
  })
})

/* ---------------------------------------------------------------- mapping */

const customerFields = [
  { key: 'code', label: 'Customer code', required: true, parse: code(), unique: true },
  {
    key: 'legalNameEn',
    label: 'Legal name (English)',
    required: true,
    aliases: ['name', 'customer name', 'legal name'],
    parse: text({ min: 2, max: 200 }),
  },
  {
    key: 'countryCode',
    label: 'Country',
    required: false,
    aliases: ['country code'],
    parse: optional(lookup('countries', { label: 'country', length: 2 })),
  },
  {
    key: 'paymentTermsDays',
    label: 'Payment terms (days)',
    required: false,
    aliases: ['terms'],
    parse: withDefault(integer({ min: 0, max: 365 }), 30),
  },
]

const customers: ImportDescriptor = { key: 'customers', label: 'Customers', fields: customerFields }

describe('autoMap', () => {
  it('matches our own template exactly', () => {
    const mapping = autoMap(
      ['Customer code', 'Legal name (English)', 'Country', 'Payment terms (days)'],
      customerFields,
    )
    expect(mapping).toEqual({ code: 0, legalNameEn: 1, countryCode: 2, paymentTermsDays: 3 })
  })

  it('falls back to an alias for a heading someone renamed', () => {
    const mapping = autoMap(['Customer code', 'Customer Name', 'Country code'], customerFields)
    expect(mapping.legalNameEn).toBe(1)
    expect(mapping.countryCode).toBe(2)
  })

  it('prefers an exact heading over another field claiming it loosely', () => {
    // "Country" must bind to countryCode even though a loose pass would let
    // an earlier field's substring match take it first.
    const mapping = autoMap(['Country', 'Customer code', 'Legal name (English)'], customerFields)
    expect(mapping.countryCode).toBe(0)
    expect(mapping.code).toBe(1)
  })

  it('never assigns one column to two fields', () => {
    const mapping = autoMap(['name', 'name'], customerFields)
    const claimed = Object.values(mapping).filter((v) => v !== null)
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('reports null for a field with no column at all', () => {
    expect(autoMap(['Customer code'], customerFields).legalNameEn).toBeNull()
  })
})

/* ------------------------------------------------------- the report (§MD) */

const lookups = { countries: new Set(['KW', 'AE', 'QA']) }

describe('validateImport — FR-MD-11', () => {
  it('accepts a clean file and returns parsed rows', () => {
    const report = readImport(
      'Customer code,Legal name (English),Country,Payment terms (days)\n' +
        'AGL,Agility Logistics,KW,45\n' +
        'KGL,Kuwait Gulf Link,KW,30\n',
      customers,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.issues).toEqual([])
    expect(report.totalRows).toBe(2)
    expect(report.rows[0]!.values).toEqual({
      code: 'AGL',
      legalNameEn: 'Agility Logistics',
      countryCode: 'KW',
      paymentTermsDays: 45,
    })
  })

  it('imports nothing when any row has an error — the acceptance criterion', () => {
    const report = readImport(
      'Customer code,Legal name (English),Country\n' +
        'AGL,Agility Logistics,KW\n' +
        'BAD,Broken Co,ZZ\n' +
        'KGL,Kuwait Gulf Link,KW\n',
      customers,
      { lookups },
    )
    expect(report.ok).toBe(false)
    // Two good rows parsed, but `ok` is false, so the caller writes neither.
    expect(report.issues).toHaveLength(1)
    expect(report.totalRows).toBe(3)
  })

  it('reports every bad row, not just the first', () => {
    const report = readImport(
      'Customer code,Legal name (English),Country\n' +
        'AGL,Agility,ZZ\n' +
        'K G L,Kuwait Gulf Link,KW\n' +
        'XYZ,X,KW\n',
      customers,
      { lookups },
    )
    expect(report.issues).toHaveLength(3)
    expect(report.issues.map((i) => i.line)).toEqual([2, 3, 4])
  })

  it('numbers lines as Excel does, with the header as line 1', () => {
    const report = readImport(
      'Customer code,Legal name (English),Country\nAGL,Agility,ZZ\n',
      customers,
      { lookups },
    )
    expect(report.issues[0]!.line).toBe(2)
  })

  it('names the field and the column the problem is in', () => {
    const report = readImport(
      'Customer code,Legal name (English),Country\nAGL,Agility,ZZ\n',
      customers,
      { lookups },
    )
    expect(report.issues[0]).toMatchObject({
      line: 2,
      field: 'countryCode',
      column: 'Country',
      code: 'unknownReference',
      values: { set: 'countries' },
      label: 'Country',
      message: 'Country: Not a known country',
    })
  })

  it('skips the blank rows Excel appends without counting them', () => {
    const report = readImport(
      'Customer code,Legal name (English)\nAGL,Agility\n\n,\n   ,\n',
      customers,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.totalRows).toBe(1)
  })

  it('catches a duplicate key inside the file and points at the earlier line', () => {
    const report = readImport(
      'Customer code,Legal name (English)\nAGL,Agility\nKGL,Kuwait Gulf Link\nAGL,Agility Again\n',
      customers,
      { lookups },
    )
    expect(report.ok).toBe(false)
    expect(report.issues[0]).toMatchObject({
      line: 4,
      code: 'duplicateInFile',
      values: { value: 'AGL', line: 2 },
      label: 'Customer code',
    })
  })

  it('catches a key that already exists in the database', () => {
    const report = readImport('Customer code,Legal name (English)\nAGL,Agility\n', customers, {
      lookups,
      existing: { code: new Set(['AGL']) },
    })
    expect(report.ok).toBe(false)
    expect(report.issues[0]).toMatchObject({ code: 'alreadyExists', values: { value: 'AGL' } })
  })

  it('fails on a missing required column without drowning the report in rows', () => {
    const report = readImport('Customer code\nAGL\nKGL\n', customers, { lookups })
    expect(report.ok).toBe(false)
    expect(report.missingRequired).toEqual(['legalNameEn'])
    // One structural issue, not one per row.
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]).toMatchObject({
      code: 'noColumn',
      values: { column: 'Legal name (English)' },
    })
    expect(report.rows).toEqual([])
  })

  it('reports unclaimed columns without treating them as errors', () => {
    const report = readImport(
      'Customer code,Legal name (English),Salesperson notes\nAGL,Agility,call Tuesdays\n',
      customers,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.ignoredColumns).toEqual(['Salesperson notes'])
  })

  it('rejects a file with headings but no rows', () => {
    const report = readImport('Customer code,Legal name (English)\n', customers, { lookups })
    expect(report.ok).toBe(false)
    expect(report.issues[0]!.code).toBe('noRows')
  })

  it('rejects a file with no headings at all', () => {
    const report = readImport('', customers, { lookups })
    expect(report.ok).toBe(false)
    expect(report.issues[0]!.code).toBe('noHeadings')
  })

  it('applies a default for a blank optional column', () => {
    const report = readImport(
      'Customer code,Legal name (English),Payment terms (days)\nAGL,Agility,\n',
      customers,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({ paymentTermsDays: 30 })
  })

  it('honours an explicit mapping, which is how FR-RT-09 differs', () => {
    // Headings that mean nothing to autoMap, mapped by hand.
    const report = readImport('col1,col2\nAGL,Agility\n', customers, {
      lookups,
      mapping: { code: 0, legalNameEn: 1, countryCode: null, paymentTermsDays: null },
    })
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({ code: 'AGL', legalNameEn: 'Agility' })
  })

  /**
   * The screen posts only what the operator chose. A partial mapping used to
   * replace the guess wholesale, so a file on the system's own template came
   * back with every required column "missing" (S13).
   */
  it('keeps the guess for every field the explicit mapping leaves out', () => {
    const report = readImport(
      'Customer code,Legal name (English),Ref\nAGL,Agility,X1\n',
      customers,
      { lookups, mapping: {} },
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({ code: 'AGL', legalNameEn: 'Agility' })

    // A field the operator deliberately unmapped stays unmapped.
    const unmapped = readImport('Customer code,Legal name (English)\nAGL,Agility\n', customers, {
      lookups,
      mapping: { legalNameEn: null },
    })
    expect(unmapped.ok).toBe(false)
  })

  it('stops reading beyond the row ceiling instead of hanging', () => {
    const body = Array.from({ length: 30 }, (_, i) => `C${i},Name ${i}`).join('\n')
    const report = readImport(`Customer code,Legal name (English)\n${body}\n`, customers, {
      lookups,
      maxRows: 10,
    })
    expect(report.ok).toBe(false)
    expect(report.issues.at(-1)).toMatchObject({ code: 'tooManyRows', values: { max: 10 } })
  })

  it('caps the issue list so a wrong mapping is not a wall of text', () => {
    const body = Array.from({ length: 50 }, (_, i) => `C${i},N${i},ZZ`).join('\n')
    const report = readImport(`Customer code,Legal name (English),Country\n${body}\n`, customers, {
      lookups,
      maxIssues: 5,
    })
    expect(report.issues).toHaveLength(5)
    expect(report.ok).toBe(false)
  })

  it('survives a ragged row by treating the missing cells as blank', () => {
    const report = readImport(
      'Customer code,Legal name (English),Country\nAGL,Agility\n',
      customers,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({ countryCode: null })
  })

  it('validates a grid directly, for a caller that parsed the file itself', () => {
    // `readImport` is parse-then-validate; the two are separable so a future
    // .xlsx reader can hand over a grid without going through text.
    const report = validateImport(
      [
        ['Customer code', 'Legal name (English)', 'Country'],
        ['AGL', 'Agility Logistics', 'KW'],
      ],
      customers,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({ code: 'AGL', countryCode: 'KW' })
  })

  it('reads a semicolon file from an Arabic-locale Excel', () => {
    const report = readImport(
      'Customer code;Legal name (English);Country\nAGL;Agility Logistics;KW\n',
      customers,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({ legalNameEn: 'Agility Logistics' })
  })
})

describe('cross-field checks', () => {
  const withWindow: ImportDescriptor<'windowBackwards'> = {
    key: 'window',
    label: 'Window',
    fields: [
      { key: 'validFrom', label: 'Valid from', required: true, parse: isoDate },
      { key: 'validTo', label: 'Valid to', required: false, parse: optional(isoDate) },
    ],
    check: (row) =>
      row.validTo !== null && (row.validTo as string) < (row.validFrom as string)
        ? { code: 'windowBackwards', message: 'Valid to is before valid from.' }
        : null,
  }

  it('rejects a validity window that ends before it starts', () => {
    const report = readImport('Valid from,Valid to\n01/03/2026,01/02/2026\n', withWindow)
    expect(report.ok).toBe(false)
    // The descriptor's own code comes through untouched, beside its English.
    expect(report.issues[0]).toMatchObject({
      line: 2,
      code: 'windowBackwards',
      message: 'Valid to is before valid from.',
    })
  })

  it('carries the values a check supplies', () => {
    const withValues: ImportDescriptor<'windowBackwards'> = {
      ...withWindow,
      check: (row) => ({
        code: 'windowBackwards',
        values: { from: row.validFrom as string },
        message: 'Valid to is before valid from.',
      }),
    }
    const report = readImport('Valid from,Valid to\n01/03/2026,\n', withValues)
    expect(report.issues[0]!.values).toEqual({ from: '2026-03-01' })
  })

  it('accepts an open-ended window', () => {
    const report = readImport('Valid from,Valid to\n01/03/2026,\n', withWindow)
    expect(report.ok).toBe(true)
  })
})

/* ------------------------------------------------------- rate cards (§RT) */

const rateFields = [
  {
    key: 'mode',
    label: 'Mode',
    required: true,
    parse: oneOf(['sea_fcl', 'sea_lcl', 'air', 'land'] as const, {
      fcl: 'sea_fcl',
      oceanfcl: 'sea_fcl',
      lcl: 'sea_lcl',
      oceanlcl: 'sea_lcl',
      ocean: 'sea_fcl',
      road: 'land',
    }),
  },
  { key: 'originCode', label: 'Origin', required: true, parse: text({ min: 3, max: 5 }) },
  { key: 'destinationCode', label: 'Destination', required: true, parse: text({ min: 3, max: 5 }) },
  { key: 'currency', label: 'Currency', required: true, parse: text({ min: 3, max: 3 }) },
  { key: 'validFrom', label: 'Valid from', required: true, parse: isoDate },
  { key: 'validTo', label: 'Valid to', required: false, parse: optional(isoDate) },
  { key: 'chargeCode', label: 'Charge', required: true, parse: text({ min: 2, max: 40 }) },
  { key: 'basis', label: 'Basis', required: true, parse: text({ min: 2, max: 40 }) },
  { key: 'rate', label: 'Rate', required: true, parse: decimal() },
  { key: 'minimum', label: 'Minimum', required: false, parse: optional(decimal()) },
  { key: 'maximum', label: 'Maximum', required: false, parse: optional(decimal()) },
  { key: 'containerType', label: 'Container', required: false, parse: optional(text({ max: 10 })) },
  {
    key: 'transitDays',
    label: 'Transit days',
    required: false,
    parse: optional((raw: string) => {
      const n = Number(normaliseDigits(raw).trim())
      return Number.isInteger(n) && n > 0
        ? cellOk(n)
        : cellFail('notWholeNumber', 'Must be a whole number of days')
    }),
  },
  { key: 'notes', label: 'Notes', required: false, parse: optional(text({ max: 500 })) },
]

const rates: ImportDescriptor = { key: 'rates', label: 'Rate cards', fields: rateFields }

describe('groupRateCards — FR-RT-09', () => {
  const read = (csv: string) => readImport<RateRowValues>(csv, rates)

  const header =
    'Mode,Origin,Destination,Currency,Valid from,Valid to,Charge,Basis,Rate,Minimum,Maximum,Container,Transit days,Notes\n'

  it('collapses several charges on one lane into one card', () => {
    const report = read(
      header +
        'FCL,AEJEA,KWSWK,USD,01/03/2026,31/03/2026,OCEAN,per_container,850,,,40HC,18,\n' +
        'FCL,AEJEA,KWSWK,USD,01/03/2026,31/03/2026,THC,per_container,120,,,40HC,,\n',
    )
    expect(report.ok).toBe(true)

    const cards = groupRateCards(report.rows)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      mode: 'sea_fcl',
      originCode: 'AEJEA',
      destinationCode: 'KWSWK',
      currency: 'USD',
      validFrom: '2026-03-01',
      validTo: '2026-03-31',
      transitDays: 18,
    })
    expect(cards[0]!.lines.map((l) => l.chargeCode)).toEqual(['OCEAN', 'THC'])
    expect(cards[0]!.lines.map((l) => l.sortOrder)).toEqual([0, 1])
  })

  it('keeps a different validity window as a separate card — FR-RT-08', () => {
    // Merging these would let a March rate answer a February enquiry.
    const cards = groupRateCards(
      read(
        header +
          'FCL,AEJEA,KWSWK,USD,01/02/2026,28/02/2026,OCEAN,per_container,800,,,40HC,,\n' +
          'FCL,AEJEA,KWSWK,USD,01/03/2026,31/03/2026,OCEAN,per_container,850,,,40HC,,\n',
      ).rows,
    )
    expect(cards).toHaveLength(2)
    expect(cards.map((c) => c.validFrom)).toEqual(['2026-02-01', '2026-03-01'])
  })

  it('separates lanes', () => {
    const cards = groupRateCards(
      read(
        header +
          'FCL,AEJEA,KWSWK,USD,01/03/2026,,OCEAN,per_container,850,,,40HC,,\n' +
          'FCL,AEJEA,QADOH,USD,01/03/2026,,OCEAN,per_container,700,,,40HC,,\n',
      ).rows,
    )
    expect(cards).toHaveLength(2)
  })

  /**
   * USD freight and KWD terminal handling on one lane and window are one
   * card: as two, they overlapped on `rate_cards_no_overlap` and the reply
   * could never be accepted (S4). Each line keeps its own currency.
   */
  it('keeps a mixed-currency lane as one card, each line in its own currency', () => {
    const cards = groupRateCards(
      read(
        header +
          'FCL,AEJEA,KWSWK,USD,01/03/2026,,OCEAN,per_container,850,,,40HC,,\n' +
          'FCL,AEJEA,KWSWK,KWD,01/03/2026,,THC,per_container,45,,,40HC,,\n',
      ).rows,
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]!.currency).toBe('USD')
    expect(cards[0]!.lines.map((l) => l.currency)).toEqual(['USD', 'KWD'])
  })

  it('takes card-level transit time from the first row that states it', () => {
    // Agents fill it on the first line of a lane and leave the rest blank; a
    // later blank must not erase it.
    const cards = groupRateCards(
      read(
        header +
          'FCL,AEJEA,KWSWK,USD,01/03/2026,,OCEAN,per_container,850,,,40HC,18,\n' +
          'FCL,AEJEA,KWSWK,USD,01/03/2026,,THC,per_container,120,,,40HC,,\n',
      ).rows,
    )
    expect(cards[0]!.transitDays).toBe(18)
  })

  it('carries the file line through to each grouped line, for the report', () => {
    const cards = groupRateCards(
      read(
        header +
          'FCL,AEJEA,KWSWK,USD,01/03/2026,,OCEAN,per_container,850,,,40HC,,\n' +
          'FCL,AEJEA,KWSWK,USD,01/03/2026,,THC,per_container,120,,,40HC,,\n',
      ).rows,
    )
    expect(cards[0]!.lines.map((l) => l.line)).toEqual([2, 3])
  })

  it('returns nothing for an empty set', () => {
    expect(groupRateCards([] as ImportRow<RateRowValues>[])).toEqual([])
  })

  it('reads a real-shaped tariff with symbols, commas and quoted names', () => {
    const report = read(
      header +
        '"Ocean FCL",AEJEA,KWSWK,USD,01/03/2026,31/03/2026,OCEAN,per_container,"$1,250.00",,,40HC,18,"Transship Jebel Ali"\n',
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values.rate).toBe('1250.00')
    expect(report.rows[0]!.values.notes).toBe('Transship Jebel Ali')
  })
})

/* --------------------------------------------------------------- artefacts */

describe('templateCsv', () => {
  it('generates the published template from the descriptor, marking required columns', () => {
    // Generated rather than maintained, so a new field cannot be missing from
    // the template people download.
    expect(templateCsv(customers)).toBe(
      'Customer code*,Legal name (English)*,Country,Payment terms (days)\n',
    )
  })

  it('quotes a heading containing a comma', () => {
    const descriptor: ImportDescriptor = {
      key: 'x',
      label: 'X',
      fields: [{ key: 'a', label: 'Port, of loading', required: true, parse: text() }],
    }
    expect(templateCsv(descriptor)).toBe('"Port, of loading*"\n')
  })
})

describe('issuesCsv', () => {
  it('returns the report in the tool the operator is fixing the file in', () => {
    const csv = issuesCsv([
      { line: 2, column: 'Country', message: 'Country: Not a known country' },
      { line: 7, message: 'Valid to is before valid from.' },
    ])
    expect(csv).toBe(
      'Line,Column,Problem\n' +
        '2,Country,Country: Not a known country\n' +
        '7,,Valid to is before valid from.\n',
    )
  })

  it('quotes a message containing a comma', () => {
    const csv = issuesCsv([{ line: 2, message: 'Must be one of: a, b' }])
    expect(csv).toContain('"Must be one of: a, b"')
  })

  /**
   * The screen hands over messages it has already translated, and headings in
   * the same language — a file whose heading row is English above Arabic
   * problems reads as half-finished.
   */
  it('takes the headings in the operator’s language', () => {
    const csv = issuesCsv(
      [{ line: 2, column: 'Country', message: 'ليست دولة معروفة' }],
      ['السطر', 'العمود', 'المشكلة'],
    )
    expect(csv).toBe('السطر,العمود,المشكلة\n2,Country,ليست دولة معروفة\n')
  })
})

/* ------------------------------------------------------------ round trip */

describe('the template round-trips', () => {
  it('produces a file the validator accepts once rows are added', () => {
    const template = templateCsv(customers)
    // The operator fills the template; the starred headings must still map.
    const filled = `${template}AGL,Agility Logistics,KW,45\n`
    const report = readImport(filled, customers, { lookups })
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({ code: 'AGL', countryCode: 'KW' })
  })
})
