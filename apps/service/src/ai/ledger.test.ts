/**
 * The ledger's one shortcut — answering a question it has already paid for.
 *
 * `input_hash` has been on `ai_invocations` since the table existed, and the
 * read side of it sat unused: `previousResponse` was written, documented, and
 * called by nothing, so the same agent invoice attached to two jobs was read —
 * and billed — twice. These cover the behaviour now that `invoke` consults it
 * on request.
 *
 * The properties are about *when the model is asked*, which is the thing that
 * costs money and the thing that is wrong quietly: a cache that answers too
 * eagerly hides a prompt regression behind a stale reply, and one that never
 * hits is indistinguishable from one that does not exist. So the assertions
 * count provider calls rather than inspecting responses.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'
import type { ModelRequest } from '../ports/index'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

/*
  A provider that answers the same thing every time and counts how often it
  was asked. `fail` makes the next call throw, which is how the "a failed call
  is not an answer" case is produced.
*/
const provider = vi.hoisted(() => ({ calls: 0, fail: false }))

vi.mock('../adapters/index', async () => {
  const { readCompletion } = await import('../adapters/model')
  return {
    modelProvider: async () => ({
      key: 'openrouter:test/model',
      available: true,
      async complete() {
        provider.calls += 1
        if (provider.fail) {
          provider.fail = false
          throw new Error('provider down')
        }
        return readCompletion(
          {
            model: 'test/model',
            choices: [
              { message: { content: JSON.stringify({ ok: true }) }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 4, cost: 0.0002 },
          },
          'test/model',
        )
      },
      stream() {
        throw new Error('not under test')
      },
    }),
  }
})

const { aiInvocations, branches, principals, systemActor, withActor, workingCalendars } =
  await import('@qabandi/db')
const { invoke } = await import('./ledger')

const BRANCH = '00000000-0000-7000-8000-00000000a1d1'
const OTHER_BRANCH = '00000000-0000-7000-8000-00000000a1d2'
const PRINCIPAL = '00000000-0000-7000-8000-00000000a1d3'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH, OTHER_BRANCH] }

/*
  Unique per run. The ledger persists, and a question asked by yesterday's run
  would be answered from it today — which is the feature, and exactly what
  would make "the first call asks the model" fail for the wrong reason.
*/
const RUN = Date.now().toString(36)
let seq = 0
const question = (): ModelRequest => {
  seq += 1
  return {
    surface: 'invoice_extract',
    messages: [{ role: 'user', content: `ledger-reuse ${RUN} ${seq}` }],
  }
}

const context = (over: { branchId?: string; promptVersion?: string } = {}) => ({
  actor,
  branchId: over.branchId ?? BRANCH,
  surface: 'invoice_extract' as const,
  promptVersion: over.promptVersion ?? 'ledger-test-v1',
})

describe.skipIf(!enabled)('answering from the ledger', () => {
  beforeAll(async () => {
    await withActor(systemActor(), async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'ledger-reuse@qabandi.test',
          nameEn: 'Ledger Fixture',
          locale: 'en',
        })
        .onConflictDoNothing()

      for (const [id, code] of [
        [BRANCH, 'LDG'],
        [OTHER_BRANCH, 'LDH'],
      ] as const) {
        await tx
          .insert(branches)
          .values({
            id,
            code,
            legalNameEn: `Ledger ${code}`,
            legalNameAr: 'فرع',
            country: 'KW',
            baseCurrency: 'KWD',
            invoiceSeries: code,
            calendarId: calendar.id,
            timeZone: 'Asia/Kuwait',
          })
          .onConflictDoNothing()
      }
    })
  })

  afterEach(() => {
    provider.fail = false
  })

  it('asks the model the first time, and records having asked', async () => {
    const before = provider.calls
    const first = await invoke(context(), question(), { reuse: true })

    expect(provider.calls).toBe(before + 1)
    expect(first.reused).toBe(false)

    const [row] = await withActor(systemActor([BRANCH]), (tx) =>
      tx.select().from(aiInvocations).where(eq(aiInvocations.id, first.invocationId)),
    )
    expect(row?.surface).toBe('invoice_extract')
    expect(row?.error).toBeNull()
  })

  it('answers the same question from the ledger without asking again', async () => {
    const request = question()
    const first = await invoke(context(), request, { reuse: true })
    const before = provider.calls

    const second = await invoke(context(), request, { reuse: true })

    expect(provider.calls).toBe(before)
    expect(second.reused).toBe(true)
    expect(second.invocationId).toBe(first.invocationId)
    expect(second.response.text).toBe(first.response.text)
  })

  /*
    The hash carries the prompt version, so a revision is a new question. This
    is the property that stops the cache hiding a prompt regression: the
    evaluation of `v2` never sees `v1`'s answers.
  */
  it('asks again when the prompt revision changes', async () => {
    const request = question()
    await invoke(context({ promptVersion: 'v1' }), request, { reuse: true })
    const before = provider.calls

    const revised = await invoke(context({ promptVersion: 'v2' }), request, { reuse: true })

    expect(provider.calls).toBe(before + 1)
    expect(revised.reused).toBe(false)
  })

  it('asks again when not told to reuse', async () => {
    const request = question()
    await invoke(context(), request, { reuse: true })
    const before = provider.calls

    const fresh = await invoke(context(), request)

    expect(provider.calls).toBe(before + 1)
    expect(fresh.reused).toBe(false)
  })

  /*
    A branch is a legal entity. An answer recorded against one branch's
    document is not another's to read, however identical the question — the
    lookup is scoped the same way RLS scopes the row.
  */
  it('does not answer one branch from another branch’s ledger', async () => {
    const request = question()
    await invoke(context({ branchId: BRANCH }), request, { reuse: true })
    const before = provider.calls

    const elsewhere = await invoke(context({ branchId: OTHER_BRANCH }), request, { reuse: true })

    expect(provider.calls).toBe(before + 1)
    expect(elsewhere.reused).toBe(false)
  })

  /*
    A failed call is recorded — the ledger is also the incident log — but it
    is not an answer. Reusing it would turn one outage into a permanent blank
    for that document.
  */
  it('does not answer from a call that failed', async () => {
    const request = question()
    provider.fail = true
    await expect(invoke(context(), request, { reuse: true })).rejects.toThrow('provider down')
    const before = provider.calls

    const retried = await invoke(context(), request, { reuse: true })

    expect(provider.calls).toBe(before + 1)
    expect(retried.reused).toBe(false)
  })
})
