/**
 * The agent current account.
 *
 * Two rules carry this module and both are easy to get backwards: the offset
 * is the *smaller* of the two balances, and a set-off moves the net balance by
 * nothing. Each has a block below, because reversing either produces numbers
 * that look plausible and send money the wrong way.
 */

import { describe, expect, it } from 'vitest'
import {
  NettingError,
  ageItems,
  buildStatement,
  money,
  netPosition,
  toScale,
  type StatementEntry,
} from '../src/index'

const usd = (v: string) => money(v, 'USD')
const at = (iso: string) => new Date(`${iso}T00:00:00Z`)

const entry = (
  id: string,
  kind: StatementEntry['kind'],
  date: string,
  amount: string,
  extra: Partial<StatementEntry> = {},
): StatementEntry => ({
  id,
  kind,
  date: at(date),
  reference: id,
  description: id,
  amount,
  ...extra,
})

describe('the statement', () => {
  it('runs the balance oldest first, whatever order it was handed', () => {
    const statement = buildStatement(
      [
        entry('receipt', 'receipt', '2026-03-10', '1000.00'),
        entry('inv-1', 'invoice', '2026-03-01', '4000.00'),
        entry('bill-1', 'bill', '2026-03-05', '3600.00'),
      ],
      'USD',
    )

    expect(statement.lines.map((l) => l.id)).toEqual(['inv-1', 'bill-1', 'receipt'])
    expect(statement.lines.map((l) => toScale(l.balance))).toEqual(['4000.00', '400.00', '-600.00'])
  })

  it('reports both sides gross as well as the net, because a statement is ticked off', () => {
    const statement = buildStatement(
      [
        entry('inv-1', 'invoice', '2026-03-01', '4000.00'),
        entry('bill-1', 'bill', '2026-03-05', '3600.00'),
      ],
      'USD',
    )

    expect(toScale(statement.receivable)).toBe('4000.00')
    expect(toScale(statement.payable)).toBe('3600.00')
    expect(toScale(statement.closing)).toBe('400.00')
  })

  it('ages by what is still open, not by the face value', () => {
    const statement = buildStatement(
      [entry('inv-1', 'invoice', '2026-03-01', '4000.00', { outstanding: '1500.00' })],
      'USD',
    )
    expect(toScale(statement.receivable)).toBe('1500.00')
  })

  it('takes a credit note off what they owe us', () => {
    const statement = buildStatement(
      [
        entry('inv-1', 'invoice', '2026-03-01', '4000.00'),
        entry('cn-1', 'credit_note', '2026-03-02', '250.00'),
      ],
      'USD',
    )
    expect(toScale(statement.receivable)).toBe('3750.00')
    expect(toScale(statement.lines[1]!.balance)).toBe('3750.00')
  })

  /*
    A set-off explains why two documents stopped being outstanding. It has to
    appear, and it has to move nothing — a line that both shows the set-off and
    adjusts the balance would double-count every settlement ever run.
  */
  it('shows a set-off without moving the balance', () => {
    const statement = buildStatement(
      [
        entry('inv-1', 'invoice', '2026-03-01', '4000.00'),
        entry('bill-1', 'bill', '2026-03-05', '3600.00'),
        entry('set-1', 'offset', '2026-03-31', '3600.00'),
      ],
      'USD',
    )
    expect(toScale(statement.lines[2]!.balance)).toBe('400.00')
    expect(toScale(statement.lines[2]!.signedAmount)).toBe('0.00')
  })
})

describe('netting', () => {
  it('offsets the smaller side and leaves the residual with a direction', () => {
    const net = netPosition(usd('4000.00'), usd('3600.00'), 'USD')
    expect(toScale(net.offset)).toBe('3600.00')
    expect(toScale(net.residual)).toBe('400.00')
    expect(net.direction).toBe('they_owe_us')
  })

  it('turns the direction round when the payable is the larger', () => {
    const net = netPosition(usd('3600.00'), usd('4000.00'), 'USD')
    expect(toScale(net.offset)).toBe('3600.00')
    expect(toScale(net.residual)).toBe('400.00')
    expect(net.direction).toBe('we_owe_them')
  })

  it('calls an exact match square, and moves no money at all', () => {
    const net = netPosition(usd('4000.00'), usd('4000.00'), 'USD')
    expect(toScale(net.residual)).toBe('0.00')
    expect(net.direction).toBe('square')
  })

  it('never offsets more than the smaller side — a payable cannot go debit', () => {
    const net = netPosition(usd('10.00'), usd('9000.00'), 'USD')
    expect(toScale(net.offset)).toBe('10.00')
  })

  it('refuses to net across currencies — that is a trade, not a set-off', () => {
    expect(() => netPosition(money('4000.00', 'USD'), money('1200.000', 'KWD'), 'USD')).toThrow(
      NettingError,
    )
  })

  it('refuses a negative balance rather than guessing which side it belongs on', () => {
    expect(() => netPosition(usd('-100.00'), usd('50.00'), 'USD')).toThrow(NettingError)
  })
})

describe('ageing', () => {
  const asOf = at('2026-03-31')

  it('buckets by how far past due, in the same buckets for both directions', () => {
    const aged = ageItems(
      [
        { outstanding: '100.00', dueOn: at('2026-04-15') },
        { outstanding: '200.00', dueOn: at('2026-03-20') },
        { outstanding: '400.00', dueOn: at('2026-02-10') },
        { outstanding: '800.00', dueOn: at('2025-11-01') },
      ],
      'USD',
      asOf,
    )

    expect(toScale(aged.current)).toBe('100.00')
    expect(toScale(aged.days30)).toBe('200.00')
    expect(toScale(aged.days60)).toBe('400.00')
    expect(toScale(aged.days90)).toBe('800.00')
    expect(toScale(aged.total)).toBe('1500.00')
  })

  it('treats a missing due date as current — a data gap is not a late payment', () => {
    const aged = ageItems([{ outstanding: '250.00', dueOn: null }], 'USD', asOf)
    expect(toScale(aged.current)).toBe('250.00')
  })

  it('puts a document due exactly today in current, not thirty days', () => {
    const aged = ageItems([{ outstanding: '250.00', dueOn: asOf }], 'USD', asOf)
    expect(toScale(aged.current)).toBe('250.00')
  })

  it('ignores anything already settled', () => {
    const aged = ageItems([{ outstanding: '0', dueOn: at('2025-01-01') }], 'USD', asOf)
    expect(toScale(aged.total)).toBe('0.00')
  })
})
