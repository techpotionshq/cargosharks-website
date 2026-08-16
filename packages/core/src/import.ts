/**
 * Bulk import — `FR-MD-11` and `FR-RT-09`.
 *
 * The client runs on paper and spreadsheets. Thirty-four years of customers,
 * agents, hauliers and ports exist today as columns in Excel, and every agent
 * tariff arrives as a differently-shaped sheet. Without an importer the only
 * way into the system is one dialog at a time, which is how a pilot quietly
 * becomes a spreadsheet with extra steps.
 *
 * Two requirements, two different problems, one engine:
 *
 *   `FR-MD-11`  master data, **against a published template** — we dictate the
 *               columns, because it is the client's own data going into our
 *               shape. Auto-mapping is a convenience.
 *   `FR-RT-09`  rate cards, **through a mapped template** — the agent dictates
 *               the columns and there are dozens of agents, so the mapping is
 *               the user's decision and must be overridable and re-usable.
 *
 * Everything here is pure: text in, report out. No file handles, no database,
 * no framework — which is what lets the whole of `FR-MD-11`'s acceptance
 * criterion run as a millisecond unit test against no infrastructure (§4).
 * The caller reads the bytes, supplies the lookup sets, and performs the
 * write; this module decides only whether the write may happen at all.
 *
 * The rule that shapes the API: **a file with errors imports nothing.** A
 * partial import leaves 800 good rows and 200 missing with no record of which,
 * and reconciling that by hand against a spreadsheet is worse than never
 * having started. `ImportReport.ok` is the whole contract.
 */

/* -------------------------------------------------------------------------
 * Delimited text
 * ---------------------------------------------------------------------- */

/**
 * What Excel actually produces, which is not one format.
 *
 * "Save as CSV" on an Arabic or European locale writes semicolons, because the
 * comma is the decimal separator. "Save as Text" writes tabs. All three reach
 * us, and guessing wrong turns one column into one field containing the whole
 * row — which then fails validation with a message about the wrong thing.
 */
export type Delimiter = ',' | ';' | '\t'

const DELIMITERS: readonly Delimiter[] = [',', ';', '\t']

/** Excel prefixes UTF-8 output with a byte-order mark; it is not data. */
const BOM = '﻿'

/**
 * Counts a delimiter in the first line, ignoring anything inside quotes.
 *
 * `"Doha, Qatar",QA` is one comma of structure and one of prose, and only the
 * quote-aware count can tell them apart.
 */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a close.
      if (quoted && line[i + 1] === '"') i++
      else quoted = !quoted
    } else if (!quoted && char === delimiter) count++
  }
  return count
}

/**
 * Picks the delimiter that best explains the header row.
 *
 * The header is used rather than the whole file because it is the one line
 * guaranteed to be structural — a data row may legitimately contain no
 * delimiter at all if every other column is empty.
 */
export function detectDelimiter(text: string): Delimiter {
  const header = stripBom(text).split(/\r?\n/, 1)[0] ?? ''
  let best: Delimiter = ','
  let bestCount = 0
  for (const delimiter of DELIMITERS) {
    const count = countOutsideQuotes(header, delimiter)
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text
}

/**
 * RFC 4180, plus the parts of reality it omits.
 *
 * Handles quoted fields containing the delimiter, doubled quotes, embedded
 * newlines (a pasted address is the common case), CRLF and bare LF, and a
 * trailing newline. Rows are returned exactly as they appear — ragged rows are
 * *not* padded here, because a row with too few columns is a fact the report
 * should state rather than a defect this function should hide.
 */
export function parseDelimited(text: string, delimiter?: Delimiter): string[][] {
  const sep = delimiter ?? detectDelimiter(text)
  const source = stripBom(text)
  const rows: string[][] = []

  let row: string[] = []
  let field = ''
  let quoted = false
  let dirty = false // this row has content, even if the last field is empty

  const endField = (): void => {
    row.push(field)
    field = ''
    dirty = true
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    row = []
    dirty = false
  }

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === sep) {
      endField()
    } else if (char === '\r') {
      // Swallow CR; the LF that follows ends the row. A lone CR ends it too.
      if (source[i + 1] === '\n') i++
      endRow()
    } else if (char === '\n') {
      endRow()
    } else {
      field += char
    }
  }

  // A file not ending in a newline still has a final row to flush.
  if (dirty || field.length > 0 || quoted) endRow()

  return rows
}

/** True where every cell is blank — Excel exports trail dozens of these. */
export function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}

/* -------------------------------------------------------------------------
 * Cells
 * ---------------------------------------------------------------------- */

export type CellResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

export const cellOk = <T>(value: T): CellResult<T> => ({ ok: true, value })
export const cellFail = (message: string): CellResult<never> => ({ ok: false, message })

/**
 * Lookup sets the caller supplies from reference data.
 *
 * Passed in rather than fetched, because `core` has no database (§4). The
 * caller reads `countries`, `currencies` and the rest once per import and
 * hands over the codes; validating ten thousand rows then costs ten thousand
 * set lookups and no round trips.
 */
export interface ImportLookups {
  readonly [name: string]: ReadonlySet<string>
}

export interface ParseContext {
  readonly lookups: ImportLookups
}

export type CellParser<T> = (raw: string, context: ParseContext) => CellResult<T>

/* --- the parsers ------------------------------------------------------- */

export const text =
  (options: { min?: number; max?: number } = {}): CellParser<string> =>
  (raw) => {
    const value = raw.trim()
    const { min = 0, max = 500 } = options
    if (value.length < min) return cellFail(`At least ${min} characters`)
    if (value.length > max) return cellFail(`At most ${max} characters`)
    return cellOk(value)
  }

/**
 * A human key — a customer code, an agent code.
 *
 * Uppercased and constrained for the same reason the customer form constrains
 * it: it gets read down a phone and typed into a search box, so it must not
 * arrive with a space in it and quietly stop matching.
 */
export const code =
  (options: { min?: number; max?: number } = {}): CellParser<string> =>
  (raw) => {
    const value = raw.trim().toUpperCase()
    const { min = 2, max = 16 } = options
    if (value.length < min) return cellFail(`At least ${min} characters`)
    if (value.length > max) return cellFail(`At most ${max} characters`)
    if (!/^[A-Z0-9][A-Z0-9-]*$/.test(value)) return cellFail('Letters, numbers and hyphens only')
    return cellOk(value)
  }

/**
 * A decimal amount, as a string.
 *
 * Never parsed to a JS number — `numeric(19,6)` survives the whole journey as
 * text or it does not survive at all (§11). Accepts what a spreadsheet emits
 * and a strict regex would reject: thousands separators, a currency symbol, a
 * trailing minus, parentheses for negatives, and the Arabic-Indic digits an
 * Arabic-locale Excel writes.
 */
export const decimal =
  (options: { min?: number; allowNegative?: boolean } = {}): CellParser<string> =>
  (raw) => {
    let value = normaliseDigits(raw).trim()
    if (value === '') return cellFail('Required')

    let negative = false
    if (/^\(.*\)$/.test(value)) {
      negative = true
      value = value.slice(1, -1).trim()
    }
    if (value.endsWith('-')) {
      negative = true
      value = value.slice(0, -1).trim()
    }
    if (value.startsWith('-')) {
      negative = true
      value = value.slice(1).trim()
    }

    // Currency symbols and codes sit next to the figure in real tariffs.
    value = value.replace(/[^\d.,]/g, '')
    value = stripGrouping(value)

    if (!/^\d+(\.\d+)?$/.test(value)) return cellFail('Must be an amount')
    if (value.replace(/\D/g, '').length > 19) return cellFail('Too many digits')

    const decimals = value.split('.')[1]
    if (decimals && decimals.length > 6) return cellFail('At most six decimal places')

    if (negative && options.allowNegative !== true) return cellFail('Must not be negative')
    const signed = negative ? `-${value}` : value

    if (options.min !== undefined && Number(signed) < options.min) {
      return cellFail(`Must be at least ${options.min}`)
    }
    return cellOk(signed)
  }

/**
 * Thousands separators, without guessing wrong on `1,234` vs `1,5`.
 *
 * The ambiguity is real: a European sheet writes one and a half as `1,5`, an
 * English one writes one thousand two hundred as `1,200`. The rule that gets
 * both right is positional — a separator with exactly three digits after it
 * and another separator or a start before it is grouping; anything else is a
 * decimal point.
 */
function stripGrouping(value: string): string {
  if (!value.includes(',')) return value
  if (value.includes('.')) {
    // Both present: the last one seen is the decimal point.
    return value.lastIndexOf(',') > value.lastIndexOf('.')
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '')
  }
  const parts = value.split(',')
  const grouped = parts.slice(1).every((part) => part.length === 3)
  return grouped ? parts.join('') : parts.join('.')
}

/** Arabic-Indic and Eastern Arabic-Indic digits to ASCII. */
export function normaliseDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const point = digit.charCodeAt(0)
    const base = point >= 0x06f0 ? 0x06f0 : 0x0660
    return String(point - base)
  })
}

export const integer =
  (options: { min?: number; max?: number } = {}): CellParser<number> =>
  (raw) => {
    const value = normaliseDigits(raw).trim().replace(/[\s,]/g, '')
    if (value === '') return cellFail('Required')
    if (!/^-?\d+$/.test(value)) return cellFail('Must be a whole number')
    const parsed = Number(value)
    if (options.min !== undefined && parsed < options.min) {
      return cellFail(`Must be at least ${options.min}`)
    }
    if (options.max !== undefined && parsed > options.max) {
      return cellFail(`Must be at most ${options.max}`)
    }
    return cellOk(parsed)
  }

/**
 * A date, normalised to `YYYY-MM-DD`.
 *
 * Accepts ISO, `DD/MM/YYYY` and `DD-MM-YYYY`, which is what the region writes
 * and what Excel exports under an en-GB or ar-KW locale. Deliberately does
 * *not* accept `MM/DD/YYYY`: the two are indistinguishable for the first
 * twelve days of a month, and silently reading 03/04 as March would put a
 * tariff's validity a month wrong without any error to notice.
 */
export const isoDate: CellParser<string> = (raw) => {
  const value = normaliseDigits(raw).trim()
  if (value === '') return cellFail('Required')

  let year: number, month: number, day: number

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value)

  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else if (dmy) {
    day = Number(dmy[1])
    month = Number(dmy[2])
    year = Number(dmy[3])
  } else {
    return cellFail('Must be a date, as YYYY-MM-DD or DD/MM/YYYY')
  }

  if (month < 1 || month > 12) return cellFail('Month must be between 1 and 12')
  if (day < 1 || day > daysInMonth(year, month)) return cellFail('That day does not exist')

  const pad = (n: number): string => String(n).padStart(2, '0')
  return cellOk(`${year}-${pad(month)}-${pad(day)}`)
}

/**
 * Computed rather than taken from `Date`, so this module reads no clock of any
 * kind — not even indirectly through a constructor (§4).
 */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/**
 * Yes and no, in both languages and in the four spellings a sheet uses.
 *
 * An unrecognised value is an error rather than a silent `false`: a column of
 * "Active" that quietly imports as inactive deactivates the customer list.
 */
export const boolean =
  (options: { default?: boolean } = {}): CellParser<boolean> =>
  (raw) => {
    const value = raw.trim().toLowerCase()
    if (value === '') {
      return options.default === undefined ? cellFail('Required') : cellOk(options.default)
    }
    if (['y', 'yes', 'true', '1', 'active', 'نعم', 'فعال'].includes(value)) return cellOk(true)
    if (['n', 'no', 'false', '0', 'inactive', 'لا', 'غير فعال'].includes(value))
      return cellOk(false)
    return cellFail('Must be yes or no')
  }

/**
 * One of a fixed set — a transport mode, a partner type, a charge basis.
 *
 * Matched loosely because a human typed it: case, spaces, hyphens and
 * underscores are all normalised away, and a synonym table covers the words
 * the trade actually uses ("FCL" for `sea_fcl`, "ocean" for sea).
 */
export const oneOf =
  <T extends string>(
    values: readonly T[],
    synonyms: Readonly<Record<string, T>> = {},
  ): CellParser<T> =>
  (raw) => {
    const value = raw.trim()
    if (value === '') return cellFail('Required')
    const key = normaliseKey(value)
    const direct = values.find((candidate) => normaliseKey(candidate) === key)
    if (direct) return cellOk(direct)
    const synonym = synonyms[key]
    if (synonym) return cellOk(synonym)
    return cellFail(`Must be one of: ${values.join(', ')}`)
  }

/** A code that must exist in a reference table the caller supplied. */
export const lookup =
  (setName: string, options: { label?: string; length?: number } = {}): CellParser<string> =>
  (raw, context) => {
    const value = raw.trim().toUpperCase()
    if (value === '') return cellFail('Required')
    if (options.length !== undefined && value.length !== options.length) {
      return cellFail(`Must be ${options.length} characters`)
    }
    const set = context.lookups[setName]
    if (!set) return cellFail(`No ${options.label ?? setName} reference data loaded`)
    if (!set.has(value)) return cellFail(`Not a known ${options.label ?? setName}`)
    return cellOk(value)
  }

export const email: CellParser<string> = (raw) => {
  const value = raw.trim().toLowerCase()
  if (value === '') return cellFail('Required')
  // Deliberately permissive: the authority on deliverability is a sent
  // message, and a strict pattern rejects valid addresses more often than it
  // catches typos.
  if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(value)) return cellFail('Must be an email address')
  if (value.length > 254) return cellFail('Too long for an email address')
  return cellOk(value)
}

/** Digits, spaces and the punctuation a phone number is written with. */
export const phone: CellParser<string> = (raw) => {
  const value = normaliseDigits(raw).trim()
  if (value === '') return cellFail('Required')
  if (!/^[+()\d][\d\s()+.-]{4,30}$/.test(value)) return cellFail('Must be a phone number')
  return cellOk(value)
}

/** `optional(text())` — blank yields null instead of an error. */
export const optional =
  <T>(parser: CellParser<T>): CellParser<T | null> =>
  (raw, context) => {
    if (raw.trim() === '') return cellOk(null)
    return parser(raw, context)
  }

/** `withDefault(integer(), 30)` — blank yields the default. */
export const withDefault =
  <T>(parser: CellParser<T>, fallback: T): CellParser<T> =>
  (raw, context) => {
    if (raw.trim() === '') return cellOk(fallback)
    return parser(raw, context)
  }

function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/* -------------------------------------------------------------------------
 * Descriptors and mapping
 * ---------------------------------------------------------------------- */

export interface ImportField {
  /** Stable identifier; the key on the parsed row object. */
  readonly key: string
  /** Column heading in the published template. */
  readonly label: string
  readonly required: boolean
  /** Other headings seen in the wild that mean this field. */
  readonly aliases?: readonly string[]
  readonly parse: CellParser<unknown>
  /**
   * Duplicate detection scope — `FR-MD-10`'s sibling for files. Two rows
   * carrying the same value here is an error, and the caller may also supply
   * the values already in the database.
   */
  readonly unique?: boolean
  /** Shown under the column heading in the template and the mapping screen. */
  readonly hint?: string
}

export interface ImportDescriptor {
  readonly key: string
  readonly label: string
  readonly fields: readonly ImportField[]
  /**
   * Row-level checks that need more than one field — a validity window whose
   * end precedes its start, a minimum above a maximum.
   */
  readonly check?: (row: Record<string, unknown>) => string | null
}

/** Column index per field key; `null` where the file has no such column. */
export type Mapping = Readonly<Record<string, number | null>>

/**
 * Best guess at which column is which.
 *
 * For `FR-MD-11` this is usually the answer, because the file came from our
 * own template. For `FR-RT-09` it is a starting point the user then corrects,
 * which is the entire difference between the two requirements.
 */
export function autoMap(headers: readonly string[], fields: readonly ImportField[]): Mapping {
  const normalised = headers.map(normaliseKey)
  const taken = new Set<number>()
  const mapping: Record<string, number | null> = {}

  // Exact matches first, so a precise heading is never stolen by another
  // field's looser alias.
  for (const pass of ['exact', 'loose'] as const) {
    for (const field of fields) {
      if (mapping[field.key] != null) continue
      const candidates =
        pass === 'exact'
          ? [field.key, field.label]
          : [field.key, field.label, ...(field.aliases ?? [])]
      const wanted = candidates.map(normaliseKey)

      const index = normalised.findIndex(
        (header, at) =>
          !taken.has(at) &&
          header !== '' &&
          (pass === 'exact'
            ? wanted.includes(header)
            : wanted.includes(header) || wanted.some((w) => w.length > 3 && header.includes(w))),
      )
      if (index >= 0) {
        mapping[field.key] = index
        taken.add(index)
      }
    }
  }

  for (const field of fields) mapping[field.key] ??= null
  return mapping
}

/* -------------------------------------------------------------------------
 * The report
 * ---------------------------------------------------------------------- */

export interface RowIssue {
  /**
   * Line number as the operator sees it in Excel: the header is line 1, so the
   * first data row is line 2. Off-by-one here sends someone to the wrong row
   * of a two-thousand-row sheet.
   */
  readonly line: number
  readonly field?: string
  readonly column?: string
  readonly message: string
}

export interface ImportRow<T> {
  readonly line: number
  readonly values: T
}

export interface ImportReport<T = Record<string, unknown>> {
  /** `FR-MD-11`: false means nothing is written. There is no partial import. */
  readonly ok: boolean
  readonly headers: readonly string[]
  readonly mapping: Mapping
  readonly rows: readonly ImportRow<T>[]
  readonly issues: readonly RowIssue[]
  /** Data rows considered, blank rows excluded. */
  readonly totalRows: number
  /** Required fields no column could be found for — a mapping problem. */
  readonly missingRequired: readonly string[]
  /** Columns in the file that no field claimed. Reported, never an error. */
  readonly ignoredColumns: readonly string[]
}

export interface ValidateOptions {
  readonly lookups?: ImportLookups
  /** Explicit mapping, for `FR-RT-09`. Omitted, `autoMap` decides. */
  readonly mapping?: Mapping
  /** Keys already in the database, per unique field, for collision reporting. */
  readonly existing?: Readonly<Record<string, ReadonlySet<string>>>
  /** Guard against a pasted novel. Rows beyond this are not read. */
  readonly maxRows?: number
  /** Stop collecting after this many issues, so a bad mapping is not a wall. */
  readonly maxIssues?: number
}

const DEFAULT_MAX_ROWS = 20_000
const DEFAULT_MAX_ISSUES = 500

/**
 * Validate a parsed sheet against a descriptor.
 *
 * Every row is checked even after the first failure, because the acceptance
 * criterion is a *row-by-row report*: telling someone about row 12, waiting
 * for them to fix it and then telling them about row 13 is how a thousand-row
 * import takes a week.
 */
export function validateImport<T = Record<string, unknown>>(
  grid: readonly (readonly string[])[],
  descriptor: ImportDescriptor,
  options: ValidateOptions = {},
): ImportReport<T> {
  const {
    lookups = {},
    existing = {},
    maxRows = DEFAULT_MAX_ROWS,
    maxIssues = DEFAULT_MAX_ISSUES,
  } = options

  const context: ParseContext = { lookups }
  const issues: RowIssue[] = []
  const add = (issue: RowIssue): void => {
    if (issues.length < maxIssues) issues.push(issue)
  }

  const [headerRow, ...body] = grid
  const headers = (headerRow ?? []).map((header) => header.trim())

  if (headers.length === 0 || headers.every((header) => header === '')) {
    return {
      ok: false,
      headers: [],
      mapping: {},
      rows: [],
      issues: [{ line: 1, message: 'The first row must be the column headings.' }],
      totalRows: 0,
      missingRequired: descriptor.fields.filter((f) => f.required).map((f) => f.key),
      ignoredColumns: [],
    }
  }

  const mapping = options.mapping ?? autoMap(headers, descriptor.fields)

  const missingRequired = descriptor.fields
    .filter((field) => field.required && mapping[field.key] == null)
    .map((field) => field.key)

  for (const key of missingRequired) {
    const field = descriptor.fields.find((f) => f.key === key)!
    add({ line: 1, field: key, message: `No column found for "${field.label}".` })
  }

  const claimed = new Set(Object.values(mapping).filter((index): index is number => index !== null))
  const ignoredColumns = headers.filter((header, index) => header !== '' && !claimed.has(index))

  // A mapping that cannot supply the required fields makes row validation
  // noise — every row would fail for the same structural reason.
  if (missingRequired.length > 0) {
    return {
      ok: false,
      headers,
      mapping,
      rows: [],
      issues,
      totalRows: body.filter((row) => !isBlankRow(row)).length,
      missingRequired,
      ignoredColumns,
    }
  }

  const seen = new Map<string, Map<string, number>>()
  for (const field of descriptor.fields) {
    if (field.unique) seen.set(field.key, new Map())
  }

  const rows: ImportRow<T>[] = []
  let totalRows = 0

  for (let index = 0; index < body.length; index++) {
    const raw = body[index]!
    if (isBlankRow(raw)) continue

    const line = index + 2 // header is line 1
    totalRows++

    if (totalRows > maxRows) {
      add({
        line,
        message: `More than ${maxRows.toLocaleString('en')} rows. Split the file and import in parts.`,
      })
      break
    }

    const values: Record<string, unknown> = {}
    let rowOk = true

    for (const field of descriptor.fields) {
      const at = mapping[field.key]
      const cell = at == null ? '' : (raw[at] ?? '')
      const result = field.parse(cell, context)

      if (!result.ok) {
        rowOk = false
        add({
          line,
          field: field.key,
          column: at == null ? undefined : headers[at],
          message: `${field.label}: ${result.message}`,
        })
        continue
      }
      values[field.key] = result.value
    }

    if (rowOk && descriptor.check) {
      const problem = descriptor.check(values)
      if (problem) {
        rowOk = false
        add({ line, message: problem })
      }
    }

    if (rowOk) {
      for (const field of descriptor.fields) {
        if (!field.unique) continue
        const value = values[field.key]
        if (typeof value !== 'string' || value === '') continue

        const previous = seen.get(field.key)!.get(value)
        if (previous !== undefined) {
          rowOk = false
          add({
            line,
            field: field.key,
            message: `${field.label}: "${value}" is already used on line ${previous}.`,
          })
          continue
        }
        seen.get(field.key)!.set(value, line)

        if (existing[field.key]?.has(value)) {
          rowOk = false
          add({
            line,
            field: field.key,
            message: `${field.label}: "${value}" already exists in the system.`,
          })
        }
      }
    }

    if (rowOk) rows.push({ line, values: values as T })
  }

  if (totalRows === 0) {
    add({ line: 1, message: 'The file has headings but no rows.' })
  }

  return {
    ok: issues.length === 0 && totalRows > 0,
    headers,
    mapping,
    rows,
    issues,
    totalRows,
    missingRequired,
    ignoredColumns,
  }
}

/** Parse and validate in one step, from raw file text. */
export function readImport<T = Record<string, unknown>>(
  text: string,
  descriptor: ImportDescriptor,
  options: ValidateOptions & { delimiter?: Delimiter } = {},
): ImportReport<T> {
  return validateImport<T>(parseDelimited(text, options.delimiter), descriptor, options)
}

/**
 * The published template — `FR-MD-11`'s "against a published template".
 *
 * Generated from the descriptor rather than maintained as a file, so a field
 * added to the importer cannot be missing from the template people download.
 */
export function templateCsv(descriptor: ImportDescriptor): string {
  const quote = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  const headings = descriptor.fields.map((field) =>
    quote(field.required ? `${field.label}*` : field.label),
  )
  return `${headings.join(',')}\n`
}

/**
 * Issues as a downloadable report.
 *
 * The operator fixing the file is working in Excel, not reading a screen, so
 * the report has to arrive in the same tool as the data.
 */
export function issuesCsv(issues: readonly RowIssue[]): string {
  const quote = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  const lines = ['Line,Column,Problem']
  for (const issue of issues) {
    lines.push([issue.line, quote(issue.column ?? ''), quote(issue.message)].join(','))
  }
  return `${lines.join('\n')}\n`
}

/* -------------------------------------------------------------------------
 * Rate cards — FR-RT-09
 * ---------------------------------------------------------------------- */

/**
 * An agent tariff is a flat sheet; a rate card is a header and its lines.
 *
 * Every agent sends one row per lane and charge — Jebel Ali to Shuwaikh, 40ft,
 * $850 — and the system stores a `rate_cards` row carrying the lane and
 * validity with `rate_card_lines` beneath it. Grouping is therefore part of
 * the import, and it is pure enough to test without a database.
 *
 * Rows group by everything that identifies the card. Two rows differing only
 * in charge type or container type belong to the same card; a row with a
 * different validity window is a different card, because `FR-RT-08` versions
 * cards by effective date and merging them would let a March rate answer a
 * February enquiry.
 */
export interface RateRowValues {
  readonly mode: string
  readonly originCode: string
  readonly destinationCode: string
  readonly currency: string
  readonly validFrom: string
  readonly validTo: string | null
  readonly chargeCode: string
  readonly basis: string
  readonly rate: string
  readonly minimum: string | null
  readonly maximum: string | null
  readonly containerType: string | null
  readonly transitDays: number | null
  readonly notes: string | null
}

export interface GroupedRateCard {
  readonly key: string
  readonly mode: string
  readonly originCode: string
  readonly destinationCode: string
  readonly currency: string
  readonly validFrom: string
  readonly validTo: string | null
  readonly transitDays: number | null
  readonly notes: string | null
  readonly lines: readonly {
    readonly line: number
    readonly chargeCode: string
    readonly basis: string
    readonly rate: string
    readonly minimum: string | null
    readonly maximum: string | null
    readonly containerType: string | null
    readonly sortOrder: number
  }[]
}

export function rateCardKey(row: RateRowValues): string {
  return [
    row.mode,
    row.originCode,
    row.destinationCode,
    row.currency,
    row.validFrom,
    row.validTo ?? '',
  ].join('|')
}

/** Mutable while grouping; frozen into `GroupedRateCard` on the way out. */
type CardDraft = {
  -readonly [K in keyof GroupedRateCard]: K extends 'lines'
    ? GroupedRateCard['lines'][number][]
    : GroupedRateCard[K]
}

export function groupRateCards(rows: readonly ImportRow<RateRowValues>[]): GroupedRateCard[] {
  const cards = new Map<string, CardDraft>()

  for (const { line, values } of rows) {
    const key = rateCardKey(values)
    let card = cards.get(key)

    if (!card) {
      card = {
        key,
        mode: values.mode,
        originCode: values.originCode,
        destinationCode: values.destinationCode,
        currency: values.currency,
        validFrom: values.validFrom,
        validTo: values.validTo,
        transitDays: values.transitDays,
        notes: values.notes,
        lines: [],
      }
      cards.set(key, card)
    }

    // Transit time and notes are card-level facts written on only one row of
    // the agent's sheet — usually the first of a lane, with the continuation
    // rows left blank. First non-empty wins, so a blank row cannot erase what
    // an earlier one stated.
    card.transitDays ??= values.transitDays
    card.notes ??= values.notes

    card.lines.push({
      line,
      chargeCode: values.chargeCode,
      basis: values.basis,
      rate: values.rate,
      minimum: values.minimum,
      maximum: values.maximum,
      containerType: values.containerType,
      sortOrder: card.lines.length,
    })
  }

  return [...cards.values()]
}
