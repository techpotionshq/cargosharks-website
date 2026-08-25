/**
 * Writing a CSV that survives the programs people actually open it in.
 *
 * Three conventions, none of them cosmetic, and each of them a bug that has
 * been shipped by somebody before. They were written twice — once in
 * `reports/margin.csv` and once in `audit.csv` — which is one copy more than a
 * formula guard should ever have.
 *
 * **The byte-order mark is not optional.** Excel on Windows reads a CSV without
 * one in the system ANSI codepage, which turns every Arabic name into mojibake.
 * Three bytes fix it, and half the customer names in this product are Arabic.
 *
 * **CRLF**, because that is what RFC 4180 says and what Excel expects.
 *
 * **The formula guard is the security-relevant half.** A field beginning `=`,
 * `+`, `-` or `@` is executed as a formula by Excel and by Sheets on open, so a
 * customer named `=cmd|' /c calc'!A0` is a spreadsheet injection carried out of
 * this system in a file somebody forwards to their accountant. The leading
 * apostrophe is the standard defence and is invisible in the cell. Every value
 * in these files came off an operator's keyboard or out of a mailbox, so none
 * of it is trusted here.
 */

/** RFC 4180 quoting, plus the formula guard. */
export function cell(value: string | number | bigint | null | undefined): string {
  const text = String(value ?? '')
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${guarded.replace(/"/g, '""')}"`
}

/**
 * A whole document: byte-order mark, quoted header, quoted rows, CRLF endings.
 *
 * `trailer` is a single unquoted-looking line appended at the end — it exists
 * for the audit export's truncation notice, and it goes through `cell` like
 * everything else so that a note can never be mistaken for extra columns.
 */
export function csvDocument(
  header: readonly string[],
  rows: readonly (readonly (string | number | bigint | null | undefined)[])[],
  trailer?: string,
): string {
  const lines = [header.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))]
  if (trailer !== undefined) lines.push(cell(trailer))
  return `﻿${lines.join('\r\n')}\r\n`
}
