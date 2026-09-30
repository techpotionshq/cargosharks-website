/**
 * The import report, worded.
 *
 * The engine hands over codes and values; `describeIssue` turns each into a
 * catalogue key. The translator here is a stand-in that echoes the key and the
 * values it was given — the key stands in for the sentence, the way the other
 * validation suites do it — so these assertions are about *which* sentence and
 * *with what*, not about wording that belongs to the catalogue.
 *
 * No database and no `next-intl`: the reports come from the real descriptors
 * and the real engine, which is the path the console takes.
 */

import { describe, expect, it } from 'vitest'
import { issuesCsv, readImport } from '@qabandi/core/import'
import {
  customerContactDescriptor,
  customerDescriptor,
  openReceivableDescriptor,
  rateCardDescriptor,
} from './descriptors'
import { describeIssue, type ImportIssue } from './issue-messages'

const t = (key: string, values?: Record<string, string | number>): string =>
  values === undefined ? key : `${key}${JSON.stringify(values)}`

const lookups = {
  countries: new Set(['KW', 'AE']),
  currencies: new Set(['KWD', 'USD']),
  locations: new Set(['AEJEA', 'KWSWK']),
  chargeTypes: new Set(['OCEAN']),
}

const first = (issues: readonly ImportIssue[]): ImportIssue => issues[0]!

describe('describeIssue', () => {
  it('leads with the field heading, and words the cell problem inside it', () => {
    const report = readImport(
      'Customer code,Legal name (English),Country\nAGL,Agility,ZZ\n',
      customerDescriptor,
      { lookups },
    )
    expect(describeIssue(t, first(report.issues))).toBe(
      'inField{"field":"Country","problem":"unknownCountry"}',
    )
  })

  /**
   * One sentence per reference set, because an Arabic sentence agrees with its
   * noun — a currency and a location are not the same grammar.
   */
  it('picks the sentence for the set that did not know the value', () => {
    const header = 'Mode,Origin,Destination,Currency,Valid from,Charge,Basis,Rate,Container\n'
    const cases = [
      ['FCL,ZZZZZ,KWSWK,USD,01/03/2026,OCEAN,flat,1,', 'unknownLocation'],
      ['FCL,AEJEA,KWSWK,XYZ,01/03/2026,OCEAN,flat,1,', 'unknownCurrency'],
      ['FCL,AEJEA,KWSWK,USD,01/03/2026,MYSTERY,flat,1,', 'unknownChargeType'],
    ] as const
    for (const [row, key] of cases) {
      const report = readImport(`${header}${row}\n`, rateCardDescriptor, { lookups })
      expect(describeIssue(t, first(report.issues))).toContain(`"problem":"${key}"`)
    }
  })

  it('passes a count through for the catalogue to pluralise', () => {
    const report = readImport('Customer code,Legal name (English)\nAGL,X\n', customerDescriptor, {
      lookups,
    })
    expect(describeIssue(t, first(report.issues))).toContain('tooShort{\\"min\\":2}')
  })

  it('words a sheet-level problem with no field in front of it', () => {
    const report = readImport('', customerDescriptor, { lookups })
    expect(describeIssue(t, first(report.issues))).toBe('noHeadings')
  })

  it('words a descriptor check, with the amounts as the operator typed them', () => {
    const report = readImport(
      'Invoice number,Customer code,Currency,Issue date,Net amount,Tax amount,Gross total\n' +
        'INV-1,AGL,KWD,2026-06-30,1000.000,50.000,1000.000\n',
      openReceivableDescriptor,
      { lookups },
    )
    expect(describeIssue(t, first(report.issues))).toBe(
      'totalMismatch{"net":"1000.000","tax":"50.000","total":"1000.000"}',
    )
  })

  it('words the write-time unknown customer the same way as the rest', () => {
    const issue: ImportIssue = {
      line: 3,
      field: 'customerCode',
      column: 'Customer code',
      code: 'unknownCustomer',
      values: { value: 'NO-SUCH' },
      label: 'Customer code',
      message: 'Customer code: No such customer "NO-SUCH" — import customers first',
    }
    expect(describeIssue(t, issue)).toBe(
      'inField{"field":"Customer code","problem":"unknownCustomer{\\"value\\":\\"NO-SUCH\\"}"}',
    )
  })

  /**
   * The download is built from the worded issues, so it says what the table
   * said — in the operator's language, under headings in the same language.
   */
  it('feeds the problems CSV with the worded text rather than the English', () => {
    const report = readImport(
      'Customer code,Contact name,Email\nAGL,Fatima,not-an-address\n',
      customerContactDescriptor,
      { lookups },
    )
    const worded = report.issues.map((issue) => ({ ...issue, message: describeIssue(t, issue) }))
    const csv = issuesCsv(worded, ['L', 'C', 'P'])
    expect(csv.split('\n')[0]).toBe('L,C,P')
    expect(csv).toContain('notEmail')
    expect(csv).not.toContain('Must be an email address')
  })
})
