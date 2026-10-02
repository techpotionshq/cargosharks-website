/**
 * The assistant across turns — what a follow-up question is answered from.
 *
 * ai-2, found live: the second question in a thread was answered with
 * invented references and balances and no lookup at all. The history sent
 * back to the model was the assistant's own prose with every tool call and
 * result stripped, so the model was shown a transcript of answers with no
 * evidence behind them — and continued it.
 *
 * The fake model below behaves the way the live one did, which is the point
 * of it: shown an earlier answer as words alone it answers the follow-up from
 * the words, inventing what it was not shown; shown the lookups behind it, it
 * answers what those cover and looks up what they do not. The assertions are
 * about which of those happens, because that is the difference between a
 * real figure and a plausible one.
 *
 * No database: the ledger and the queries are replaced, since what is under
 * test is the transcript the loop builds and not either of those.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@qabandi/db'
import type { ModelMessage, ModelRequest, ModelResponse } from '../ports/index'

const world = vi.hoisted(() => ({
  requests: [] as { messages: readonly ModelMessage[] }[],
  toolRuns: [] as { name: string; args: Record<string, unknown> }[],
  /** When set, the model's replies in order, in place of `fakeModel`. */
  script: [] as (() => ModelResponse)[],
}))

/*
  The invoices the fake queries know about. KWI-INV-9 is deliberately not
  overdue, so the overdue list in the first turn does not mention it — the
  follow-up asks about a record the earlier lookup never returned.
*/
const INVOICES: Record<string, { balance: string; currency: string }> = {
  'KWI-INV-1': { balance: '150.000000', currency: 'KWD' },
  'KWI-INV-9': { balance: '42.500000', currency: 'KWD' },
}

function reply(text: string, calls: { name: string; args: object }[] = []): ModelResponse {
  return {
    text,
    toolCalls: calls.map((call, n) => ({
      id: `call-${world.requests.length}-${n}`,
      name: call.name,
      arguments: JSON.stringify(call.args),
    })),
    model: 'test/model',
    inputTokens: 1,
    outputTokens: 1,
    finishReason: calls.length > 0 ? 'tool_calls' : 'stop',
    raw: null,
  }
}

const text = (message: ModelMessage): string =>
  typeof message.content === 'string' ? message.content : ''

/**
 * A model with the live one's habit.
 *
 * It reads the newest user question, then: if a tool result *after* that
 * question has come back, it answers from it; if any earlier tool result in
 * the transcript covers the invoice asked about, it answers from that; if the
 * transcript shows lookups but none covers this invoice, it looks it up; and
 * if the transcript has no lookups in it at all, it answers from the prose —
 * with a number it made up.
 */
function fakeModel(request: ModelRequest): ModelResponse {
  const scripted = world.script.shift()
  if (scripted) return scripted()
  const messages = request.messages
  const lastUser = messages.map((m) => m.role).lastIndexOf('user')
  const question = text(messages[lastUser]!)
  const asked = question.match(/KWI-INV-\d+/)?.[0]

  const fresh = messages.slice(lastUser + 1).filter((m) => m.role === 'tool')
  if (fresh.length > 0) {
    const found = JSON.parse(text(fresh.at(-1)!)) as { invoice?: { number: string } }
    const inv = found.invoice ? INVOICES[found.invoice.number] : undefined
    return reply(inv ? `${asked} has ${inv.balance} ${inv.currency} outstanding.` : 'Not found.')
  }

  if (!asked) {
    return reply('', [{ name: 'list_overdue_invoices', args: { customer: null, limit: null } }])
  }

  const earlier = messages.slice(0, lastUser).filter((m) => m.role === 'tool')
  const covering = earlier.find((m) => text(m).includes(asked))
  if (covering) {
    const inv = INVOICES[asked]!
    return reply(`${asked} has ${inv.balance} ${inv.currency} outstanding (from the earlier list).`)
  }
  if (earlier.length > 0) {
    return reply('', [{ name: 'get_invoice', args: { number: asked } }])
  }
  return reply(`${asked} has 999.000 KWD outstanding.`)
}

vi.mock('./ledger', () => ({
  invoke: async (_context: unknown, request: ModelRequest) => {
    world.requests.push({ messages: [...request.messages] })
    return { response: fakeModel(request), invocationId: `inv-${world.requests.length}` }
  },
  invokeStream: async function* (_context: unknown, request: ModelRequest) {
    world.requests.push({ messages: [...request.messages] })
    const response = fakeModel(request)
    if (response.text) yield response.text
    return { response, invocationId: `inv-${world.requests.length}` }
  },
}))

vi.mock('./tools', () => ({
  runTool: async (_actor: Actor, name: string, args: Record<string, unknown>) => {
    world.toolRuns.push({ name, args })
    if (name === 'list_overdue_invoices') {
      return {
        total: 1,
        shown: 1,
        rows: [{ number: 'KWI-INV-1', balance: INVOICES['KWI-INV-1']!.balance, currency: 'KWD' }],
      }
    }
    if (name === 'list_jobs') {
      return { total: 1, shown: 1, rows: [{ reference: 'KWI-JOB-0001', status: 'in_transit' }] }
    }
    if (name === 'get_invoice') {
      const number = String(args.number)
      return INVOICES[number]
        ? { found: true, invoice: { number, ...INVOICES[number] } }
        : { found: false }
    }
    return { total: 0, shown: 0, rows: [] }
  },
  currentState: async () => undefined,
  currentCustomsState: async () => undefined,
}))

vi.mock('./prompts', () => ({
  ASSISTANT_PROMPT_VERSION: 'assistant@test',
  assistantSystemPrompt: (language: string) => `system prompt (${language})`,
}))

const { answerLanguage, ask, askStreaming, historyMessages, keepable, KEPT_RESULT_CHARS } =
  await import('./assistant')
type HistoryTurn = import('./assistant').HistoryTurn

const actor: Actor = { principalId: 'p', type: 'internal', branchIds: ['b'] }
const base = { actor, branchId: 'b', permissions: new Set<string>(), locale: 'en' as const }

beforeEach(() => {
  world.requests.length = 0
  world.toolRuns.length = 0
  world.script.length = 0
})

describe('a follow-up question', () => {
  /*
    The regression itself. The first answer is produced by the real loop, its
    lookups kept exactly as the stream route stores them, and the follow-up is
    asked with that history.
  */
  it('is answered from a fresh lookup, not invented from the earlier prose', async () => {
    const first = await ask({ ...base, question: 'Which invoices are overdue?' })
    expect(first.calls.map((call) => call.name)).toEqual(['list_overdue_invoices'])

    const history: HistoryTurn[] = [
      { role: 'user', content: 'Which invoices are overdue?' },
      { role: 'assistant', content: first.reply, calls: first.calls },
    ]
    world.toolRuns.length = 0

    const followUp = await ask({ ...base, question: 'And the balance on KWI-INV-9?', history })

    expect(world.toolRuns).toEqual([{ name: 'get_invoice', args: { number: 'KWI-INV-9' } }])
    expect(followUp.reply).toContain('42.500000 KWD')
    expect(followUp.reply).not.toContain('999')
  })

  it('is answered from the replayed result when it already covers the record', async () => {
    const first = await ask({ ...base, question: 'Which invoices are overdue?' })
    const history: HistoryTurn[] = [
      { role: 'user', content: 'Which invoices are overdue?' },
      { role: 'assistant', content: first.reply, calls: first.calls },
    ]
    world.toolRuns.length = 0

    const followUp = await ask({ ...base, question: 'How much is left on KWI-INV-1?', history })

    expect(world.toolRuns).toEqual([])
    expect(followUp.reply).toContain('150.000000 KWD')
  })

  /*
    The control: the same follow-up with the history as it used to be sent —
    words only. This is the fake's hallucination, and it is what the live
    model did. If this ever stops inventing, the fake no longer models the
    failure and the test above proves nothing.
  */
  it('was invented when the history carried words alone', async () => {
    const history: HistoryTurn[] = [
      { role: 'user', content: 'Which invoices are overdue?' },
      { role: 'assistant', content: 'KWI-INV-1 is overdue with 150.000000 KWD outstanding.' },
    ]

    const followUp = await ask({ ...base, question: 'And the balance on KWI-INV-9?', history })

    expect(world.toolRuns).toEqual([])
    expect(followUp.reply).toContain('999.000 KWD')
  })

  it('keeps the streamed lookups with their results for the thread', async () => {
    const events = []
    for await (const event of askStreaming({ ...base, question: 'Which invoices are overdue?' })) {
      events.push(event)
    }
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.calls).toHaveLength(1)
    expect(done.calls[0]).toMatchObject({
      name: 'list_overdue_invoices',
      result: { total: 1, rows: [{ number: 'KWI-INV-1' }] },
    })
    expect(Date.parse(done.calls[0]!.at)).not.toBeNaN()
  })
})

describe('the history builder', () => {
  const call = (id: string, name: string, result: unknown) => ({
    id,
    name,
    args: { limit: null },
    result,
    at: '2026-10-02T09:00:00.000Z',
  })

  it('replays an answer as request, results, then words', () => {
    const messages = historyMessages([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1', calls: [call('c1', 'list_jobs', { total: 2 })] },
    ])

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(messages[1]!.toolCalls).toEqual([
      { id: 'c1', name: 'list_jobs', arguments: '{"limit":null}' },
    ])
    expect(messages[2]!.toolCallId).toBe('c1')
    expect(JSON.parse(messages[2]!.content as string)).toEqual({
      retrievedAt: '2026-10-02T09:00:00.000Z',
      result: { total: 2 },
    })
    expect(messages[3]!.content).toBe('a1')
  })

  it('sends a turn with no lookups as words, as before', () => {
    const messages = historyMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])
    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])
  })

  it('replays only the most recent answers’ lookups', () => {
    const history: HistoryTurn[] = []
    for (let i = 0; i < 5; i++) {
      history.push({ role: 'user', content: `q${i}` })
      history.push({ role: 'assistant', content: `a${i}`, calls: [call(`c${i}`, 'search', i)] })
    }
    const ids = historyMessages(history)
      .filter((m) => m.role === 'tool')
      .map((m) => m.toolCallId)
    expect(ids).toEqual(['c2', 'c3', 'c4'])
  })

  it('gives a call with no stored id one, so its result still pairs with it', () => {
    const messages = historyMessages([
      { role: 'assistant', content: 'a', calls: [call('', 'search', [])] },
    ])
    expect(messages[0]!.toolCalls![0]!.id).toBeTruthy()
    expect(messages[1]!.toolCallId).toBe(messages[0]!.toolCalls![0]!.id)
  })

  it('keeps a small result whole and replaces a huge one with a note', () => {
    expect(keepable({ total: 1 })).toEqual({ total: 1 })
    const huge = keepable({ rows: 'x'.repeat(KEPT_RESULT_CHARS * 2) }) as {
      truncated: boolean
      preview: string
    }
    expect(huge.truncated).toBe(true)
    expect(huge.preview.length).toBe(KEPT_RESULT_CHARS)
  })
})

describe('the language of the answer', () => {
  it('follows the question, not the screen', () => {
    expect(answerLanguage('كم شحنة ستصل خلال الأسبوع القادم؟', 'en')).toBe('ar')
    expect(answerLanguage('Which invoices are overdue?', 'ar')).toBe('en')
  })

  it('reads an Arabic question with a Latin reference in it as Arabic', () => {
    expect(answerLanguage('ما هو رصيد الفاتورة KWI-INV-2026-00012؟', 'en')).toBe('ar')
  })

  it('falls back to the screen when the question has no letters', () => {
    expect(answerLanguage('KWI-JOB-2026-00042'.replace(/[A-Z]/g, ''), 'ar')).toBe('ar')
  })

  it('reaches the system prompt', async () => {
    await ask({ ...base, locale: 'en', question: 'ما الفواتير المتأخرة؟' })
    expect(world.requests[0]!.messages[0]!.content).toBe('system prompt (ar)')
  })
})

describe('a tool argument outside its vocabulary', () => {
  it('goes back to the model as a correctable error, and runs nothing', async () => {
    world.script.push(
      () => reply('', [{ name: 'list_jobs', args: { mode: 'boat' } }]),
      () => reply('', [{ name: 'list_jobs', args: { mode: 'Sea', status: 'None' } }]),
      () => reply('None at the moment.'),
    )

    await ask({ ...base, question: 'How many sea shipments do we have?' })

    // The refused call never reached a query; the corrected one did, normalised.
    expect(world.toolRuns).toEqual([
      { name: 'list_jobs', args: { mode: 'sea', status: null, direction: null } },
    ])
    const refusal = world.requests[1]!.messages.at(-1)!
    expect(refusal.role).toBe('tool')
    expect(text(refusal)).toContain('sea_fcl')
  })
})

describe('what a tool result shows the model', () => {
  /*
    A live Arabic answer put `in_transit` in a table under Arabic headings.
    The result now carries the label beside the code, in the answer's language.
  */
  it('carries the label beside each code, in the language of the answer', async () => {
    world.script.push(
      () => reply('', [{ name: 'list_jobs', args: { status: 'in_transit' } }]),
      () => reply('شحنة واحدة قيد النقل.'),
    )

    await ask({ ...base, locale: 'en', question: 'ما الشحنات قيد النقل؟' })

    const result = JSON.parse(text(world.requests[1]!.messages.at(-1)!)) as {
      rows: { status: string; statusLabel: string }[]
    }
    expect(result.rows[0]).toEqual({
      reference: 'KWI-JOB-0001',
      status: 'in_transit',
      statusLabel: 'قيد النقل',
    })
  })
})
