/**
 * The accept path's fixed vocabularies, pinned against the database's.
 *
 * `resolveProposal` refuses a `mode` or `tradeDirection` that is not on its
 * list — the right refusal, because the value is text a model produced and
 * the column is a Postgres enum. The list is hand-written, which means a
 * migration adding a mode would leave this screen refusing a perfectly valid
 * proposal with "expected sea_fcl, sea_lcl, …" and no hint that the list was
 * the thing out of date. This is the hint.
 *
 * Split from `proposals.test.ts` because that file needs a database and this
 * needs nothing: the enum's values are read off the schema object, not a
 * connection.
 */

import { describe, expect, it } from 'vitest'
import { directionEnum, modeEnum } from '@qabandi/db'
import { DIRECTIONS, MODES, resolveProposal } from './proposals'

describe('the accept path’s vocabularies', () => {
  it('accepts every transport mode the database allows, and no other', () => {
    expect([...MODES].sort()).toEqual([...modeEnum.enumValues].sort())
  })

  it('accepts every trade direction the database allows, and no other', () => {
    expect([...DIRECTIONS].sort()).toEqual([...directionEnum.enumValues].sort())
  })
})

/*
  F50: a container count resolves without a lookup, so the transaction is never
  touched and none is needed here. Positive, not merely whole — the 0048
  constraint refuses zero, and a resolution that only failed at the write would
  reach the coordinator as a server error rather than a sentence.
*/
describe('resolving a proposed container count', () => {
  const tx = {} as Parameters<typeof resolveProposal>[0]

  it('lands a stated count in the container column as a number', async () => {
    expect(await resolveProposal(tx, 'containerCount', ' 2 ')).toEqual({
      ok: true,
      column: 'containerCount',
      value: 2,
    })
  })

  it.each(['0', '-1', '1.5', 'two', '10000'])(
    'refuses %s as not a positive whole number',
    async (raw) => {
      expect(await resolveProposal(tx, 'containerCount', raw)).toEqual({
        ok: false,
        failure: { kind: 'invalid', value: raw, expected: { kind: 'positiveInteger' } },
      })
    },
  )
})
