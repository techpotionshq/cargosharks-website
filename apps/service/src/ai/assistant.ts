/**
 * The operator assistant — the loop.
 *
 * A question comes in, the model asks for tools, the tools run under the
 * asker's own actor, and an answer comes back with any proposed actions
 * attached. `core/assistant.ts` declares what may be asked and what may be
 * proposed; `tools.ts` runs the queries; this is what turns those into a
 * conversation.
 *
 * ## It cannot change anything, and that is structural rather than careful
 *
 * There is no branch in this file that writes a business row. A `propose` tool
 * is *collected*, never executed — it comes back as a `TransitionProposal` that
 * the interface renders as a button, and pressing that button runs the ordinary
 * server action under the person's own actor. Same code path, same permission
 * check, same audit row as clicking it on the screen.
 *
 * That is what keeps the audit trail able to answer *who moved this shipment*
 * with the name of a person. An assistant that could write would make the
 * honest answer "a model, on someone's behalf, probably", and the whole point
 * of §5 is that there is no such answer in this system.
 *
 * ## Every read is scoped by the database, not by the prompt
 *
 * The actor is threaded into every tool call and `withActor` stamps it into
 * transaction-local settings that RLS reads. A coordinator cannot be talked
 * into showing another branch's shipments by any wording, because the wording
 * never reaches the policy. The prompt is a set of manners; the policy is the
 * boundary.
 *
 * ## Bounded, because a loop that is not is a spend incident
 *
 * `ASSISTANT_LIMITS` caps turns, total tool calls and rows per tool. All three
 * are ceilings rather than targets — most questions are answered in two turns —
 * and the one that matters is `maxTurns`: a model that decides to look once
 * more, forever, is billed for every look.
 */

import {
  ASSISTANT_LIMITS,
  assistantTool,
  isProposableEntity,
  normaliseToolArgs,
  proposableTransitions,
  proposeTransition,
  toolsFor,
  withLabels,
  type TransitionProposal,
} from '@qabandi/core'
import { AiError } from '@qabandi/core'
import type { Actor } from '@qabandi/db'
import type { ModelMessage, ModelTool, ModelToolCall } from '../ports/index'
import { invoke, invokeStream } from './ledger'
import { ASSISTANT_PROMPT_VERSION, assistantSystemPrompt } from './prompts'
import { currentCustomsState, currentState, runTool, type ToolArgs } from './tools'

export interface AssistantQuestion {
  readonly actor: Actor
  readonly branchId: string
  /** Permission keys this principal holds — decides which tools are offered. */
  readonly permissions: ReadonlySet<string>
  readonly locale: 'en' | 'ar'
  readonly question: string
  /**
   * Earlier turns, oldest first, with the lookups behind each answer.
   *
   * This used to be plain text only, on the reasoning that tool results are
   * large and go stale. The live cost of that was worse than either (ai-2): a
   * follow-up — "and which of those has free time running out?" — reached a
   * model holding its own earlier prose and none of the rows behind it, and it
   * answered from the prose, inventing references and balances with no lookup
   * at all. A model shown a transcript of answers-without-evidence learns that
   * answers do not need evidence.
   *
   * So the calls and their results are replayed (`historyMessages`), stamped
   * with when they were read, and the prompt says to look again for anything
   * they do not contain or that may have moved.
   */
  readonly history?: readonly HistoryTurn[]
}

/**
 * One lookup, as it ran — kept with the answer so a follow-up can see it.
 *
 * `result` is what the model was shown, or a truncation note in its place when
 * it was too long to keep (`keepable`). `at` is when it was read, which is
 * what lets the next turn tell "the list I was shown at 10:02" from "now".
 */
export interface ToolTrace {
  readonly id: string
  readonly name: string
  readonly args: ToolArgs
  readonly result: unknown
  readonly at: string
}

export interface HistoryTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly calls?: readonly ToolTrace[]
}

/**
 * How many earlier answers have their lookups replayed, newest first.
 *
 * Three, because a follow-up is about the last answer or the one before it,
 * and every replayed result is input tokens on every later turn. Older turns
 * still go back as words; a question about them is a question the model is
 * told to look up again.
 */
export const REPLAYED_ANSWERS = 3

/** The longest result kept for replay, in characters of JSON. */
export const KEPT_RESULT_CHARS = 6_000

/**
 * A tool result small enough to store and replay, or a note saying it was not.
 *
 * A preview rather than nothing, so the model can still see what kind of rows
 * came back, and an explicit instruction so it does not mistake the cut-off
 * preview for the whole list.
 */
export function keepable(result: unknown): unknown {
  const json = JSON.stringify(result) ?? 'null'
  if (json.length <= KEPT_RESULT_CHARS) return result
  return {
    truncated: true,
    note: 'This result was too long to keep. Call the tool again for the full figures.',
    preview: json.slice(0, KEPT_RESULT_CHARS),
  }
}

/**
 * The earlier conversation, in the shape the provider expects.
 *
 * An answer that used tools goes back as the model's own request, our results
 * to it, then its words — the same three-step shape the loop builds live, so
 * the model reads its earlier turns exactly as it would have seen them. Each
 * result is wrapped with `retrievedAt` so it is evidence of a moment, not of
 * now.
 *
 * Only the last `REPLAYED_ANSWERS` answers carry their lookups; earlier ones
 * are words alone. A call with no id (a row stored before ids were kept) is
 * given one: the provider pairs a result to its call by id, and an unpaired
 * result is refused outright.
 */
export function historyMessages(history: readonly HistoryTurn[]): ModelMessage[] {
  const withCalls = history
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => turn.role === 'assistant' && (turn.calls?.length ?? 0) > 0)
    .slice(-REPLAYED_ANSWERS)
  const replay = new Set(withCalls.map(({ index }) => index))

  const messages: ModelMessage[] = []
  history.forEach((turn, index) => {
    if (turn.role === 'assistant' && replay.has(index)) {
      const calls = (turn.calls ?? []).map((call, n) => ({
        ...call,
        id: call.id || `h${index}-${n}`,
      }))
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: calls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        })),
      })
      for (const call of calls) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({ retrievedAt: call.at, result: call.result }),
        })
      }
    }
    messages.push({ role: turn.role, content: turn.content })
  })
  return messages
}

/**
 * Which language to answer in: the question's, then the screen's (ai-14).
 *
 * The prompt said "Answer in English." on an English screen, so a person who
 * asked in Arabic got English — and on an Arabic screen, a model reading
 * English tool results drifted back into English after the first lookup.
 * Deciding here, by script, makes the instruction one fixed sentence the
 * model cannot weigh against the results' language. Majority of letters
 * rather than "any Arabic", because an English question can quote an Arabic
 * name and an Arabic one nearly always carries a Latin reference.
 */
export function answerLanguage(question: string, locale: 'en' | 'ar'): 'en' | 'ar' {
  const arabic = (question.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? [])
    .length
  const latin = (question.match(/[A-Za-z]/g) ?? []).length
  if (arabic === 0 && latin === 0) return locale
  return arabic >= latin ? 'ar' : 'en'
}

export interface AssistantAnswer {
  readonly reply: string
  /** Actions offered to the person. Nothing has been done. */
  readonly proposals: readonly TransitionProposal[]
  /** What was looked at, so the interface can show its working. */
  readonly used: readonly { name: string; args: ToolArgs }[]
  /** The same lookups with their results, for the thread to keep (ai-2). */
  readonly calls: readonly ToolTrace[]
  /** Every ledger row this answer produced, for cost and for audit. */
  readonly invocationIds: readonly string[]
  /** Why the loop stopped, where it did not stop by answering. */
  readonly truncated?: 'turns' | 'tool_calls'
}

/**
 * What the interface is told, as it happens.
 *
 * Typed events rather than a text stream, because three different things
 * arrive and only one of them is prose. A tool call is progress — *"checking
 * overdue invoices"* — and the *name* of the tool is what the interface turns
 * into that sentence, in the reader's own language. It is never shown raw: a
 * coordinator reading `list_overdue_invoices({"customer":null})` is being
 * shown our schema, which is not their business and not their language.
 */
export type AssistantEvent =
  /** A tool is about to run. The name is a key, not a label. */
  | { readonly type: 'step'; readonly tool: string }
  /** A fragment of the answer, to append immediately. */
  | { readonly type: 'text'; readonly text: string }
  /** The end: everything the interface needs to settle the turn. */
  | {
      readonly type: 'done'
      readonly reply: string
      readonly proposals: readonly TransitionProposal[]
      readonly used: readonly string[]
      /** Every lookup with its result, for the thread to keep (ai-2). */
      readonly calls: readonly ToolTrace[]
      readonly invocationIds: readonly string[]
      readonly truncated?: 'turns' | 'tool_calls'
    }

/** Our tool declarations, in the provider's shape. */
/**
 * The kept fragments, joined into one answer *without* flattening it.
 *
 * This used to be `join(' ').replace(/\s+/g, ' ')`, which collapsed every
 * newline the model wrote — so an answer listing four overdue invoices as a
 * bullet list arrived as one run-on sentence with stray hyphens in it, and the
 * panel's list and table renderers had nothing to recognise. Worse, the
 * *streamed* text was correct and the settled turn that replaced it was not,
 * so a good answer visibly collapsed a second after it finished arriving.
 *
 * Fragments are separated by a blank line because they come from different
 * model turns — text said beside a tool call, then text said after its result
 * came back. Trailing spaces go and runs of blank lines collapse to one;
 * leading indentation is left alone, since it is what makes a nested bullet
 * nested.
 */
function joinFragments(fragments: readonly string[]): string {
  return fragments
    .join('\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function wireTools(permissions: ReadonlySet<string>): ModelTool[] {
  return toolsFor(permissions).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

/**
 * Ask the assistant one question.
 *
 * Returns when the model answers in words, or when a bound is reached. A
 * bounded stop still returns whatever text there is plus `truncated`, because
 * a partial answer with a note is more use than an error — and because the
 * person can simply ask again more narrowly.
 */
export async function ask(input: AssistantQuestion): Promise<AssistantAnswer> {
  const { actor, branchId, permissions, locale, question } = input

  const messages: ModelMessage[] = [
    { role: 'system', content: assistantSystemPrompt(answerLanguage(question, locale)) },
    ...historyMessages(input.history ?? []),
    { role: 'user', content: question },
  ]

  const tools = wireTools(permissions)
  const proposals: TransitionProposal[] = []
  const used: { name: string; args: ToolArgs }[] = []
  const trace: ToolTrace[] = []
  const invocationIds: string[] = []

  let calls = 0
  let empty = 0

  /*
    Text the model emitted *alongside* a tool call, kept.

    Most models answer either in words or with a tool call, and an earlier
    version assumed that and returned only the final turn's text. A live call
    proved it wrong in the worst possible way: asked which invoices were
    overdue, `minimax/minimax-m3` emitted "No" beside its tool call and
    "invoices are currently overdue." after the result came back. Keeping only
    the last turn produced "invoices are currently overdue." — a sentence that
    asserts the exact opposite of the truth, about money, with no sign that
    anything had been dropped.

    So every non-empty fragment is kept in order and joined. The cost of being
    wrong the other way is a leading "Let me check that." on some answers,
    which is untidy; the cost of dropping a fragment is a false statement.
  */
  const said: string[] = []
  const answer = (): string => joinFragments(said)

  for (let turn = 0; turn < ASSISTANT_LIMITS.maxTurns; turn++) {
    const { response, invocationId } = await invoke(
      {
        actor,
        branchId,
        surface: 'assistant',
        promptVersion: ASSISTANT_PROMPT_VERSION,
      },
      { surface: 'assistant', messages, tools, maxOutputTokens: 2_000 },
    )

    invocationIds.push(invocationId)

    /*
      Neither words nor a tool call — an empty turn.

      `minimax/minimax-m3` does this occasionally: a well-formed response whose
      content is blank, seen roughly once in a dozen calls during verification
      and never reproducibly. It is not an error the provider reports, so
      nothing below would notice; the person would simply get a blank bubble.

      Retried by *continuing the loop* rather than by a retry inside the
      adapter, and the distinction is deliberate. `adapters/model.ts` has no
      retry because pg-boss already retries everything queued — and the
      assistant is the one surface that is not queued, so nothing else would
      ever try again. Each attempt is a fresh ledger row, so an operator can
      see how often this happens rather than having it hidden inside a call
      that looks like one.

      The turn budget is the ceiling: a model that answers nothing forever
      stops when the loop does, not when patience runs out.
    */
    if (response.toolCalls.length === 0 && response.text.trim() === '') {
      empty++
      if (empty <= 1) continue
      return { reply: answer(), proposals, used, calls: trace, invocationIds }
    }

    if (response.toolCalls.length === 0) {
      if (response.text.trim()) said.push(response.text.trim())
      return { reply: answer(), proposals, used, calls: trace, invocationIds }
    }

    if (calls + response.toolCalls.length > ASSISTANT_LIMITS.maxToolCalls) {
      if (response.text.trim()) said.push(response.text.trim())
      return {
        reply: answer(),
        proposals,
        used,
        calls: trace,
        invocationIds,
        truncated: 'tool_calls',
      }
    }

    /*
      The model's own request goes back into the transcript beside our answers.

      Dropping it and sending only the results produces a model that asks for
      the same tool again, having no record of having asked — a loop that ends
      on the turn limit rather than on an answer.
    */
    if (response.text.trim()) said.push(response.text.trim())
    messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls })

    for (const call of response.toolCalls) {
      calls++
      const result = await execute(input, call, proposals)
      used.push({ name: call.name, args: result.args })
      trace.push(traced(call, result))
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify(result.value),
      })
    }
  }

  /*
    Out of turns with tools still being asked for.

    The model is told so in its own transcript rather than being cut off
    silently, and given one final turn with no tools — which reliably produces
    "here is what I found, and what I could not check" instead of nothing.
  */
  messages.push({
    role: 'user',
    content:
      'You have run out of lookups. Answer now with what you already have, and say plainly what you could not check.',
  })

  const { response, invocationId } = await invoke(
    { actor, branchId, surface: 'assistant', promptVersion: ASSISTANT_PROMPT_VERSION },
    { surface: 'assistant', messages, maxOutputTokens: 1_000 },
  )
  invocationIds.push(invocationId)
  if (response.text.trim()) said.push(response.text.trim())

  return { reply: answer(), proposals, used, calls: trace, invocationIds, truncated: 'turns' }
}

/**
 * The same loop, answered as it arrives.
 *
 * `ask` remains for callers that want the whole thing — a test, a worker, a
 * future scheduled digest. This is what the panel uses, and the difference is
 * only *when* the caller learns things: the tools that run, the fragments of
 * the answer, and then the settled turn.
 *
 * The fragments are accumulated here as well as yielded, because the stored
 * transcript has to be the whole answer. A person who reloads must see what
 * they read, not the last piece of it.
 */
export async function* askStreaming(input: AssistantQuestion): AsyncGenerator<AssistantEvent> {
  const { actor, branchId, permissions, locale, question } = input

  const messages: ModelMessage[] = [
    { role: 'system', content: assistantSystemPrompt(answerLanguage(question, locale)) },
    ...historyMessages(input.history ?? []),
    { role: 'user', content: question },
  ]

  const tools = wireTools(permissions)
  const proposals: TransitionProposal[] = []
  const used: string[] = []
  const trace: ToolTrace[] = []
  const invocationIds: string[] = []
  const said: string[] = []
  const answer = (): string => joinFragments(said)

  let calls = 0
  let empty = 0

  for (let turn = 0; turn < ASSISTANT_LIMITS.maxTurns; turn++) {
    const stream = invokeStream(
      { actor, branchId, surface: 'assistant', promptVersion: ASSISTANT_PROMPT_VERSION },
      { surface: 'assistant', messages, tools, maxOutputTokens: 2_000 },
    )

    let piece = await stream.next()
    while (!piece.done) {
      yield { type: 'text', text: piece.value }
      piece = await stream.next()
    }

    const settled = piece.value
    if (!settled) break

    const { response, invocationId } = settled
    invocationIds.push(invocationId)

    const text = response.text.trim()
    if (text) said.push(text)

    if (response.toolCalls.length === 0) {
      /*
        An empty turn — no words and nothing to run. Retried once by continuing
        the loop, for the reason `ask` gives at length: this is the one surface
        pg-boss does not retry, because it is not queued.
      */
      if (!text) {
        empty++
        if (empty <= 1) continue
      }
      yield { type: 'done', reply: answer(), proposals, used, calls: trace, invocationIds }
      return
    }

    if (calls + response.toolCalls.length > ASSISTANT_LIMITS.maxToolCalls) {
      yield {
        type: 'done',
        reply: answer(),
        proposals,
        used,
        calls: trace,
        invocationIds,
        truncated: 'tool_calls',
      }
      return
    }

    messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls })

    for (const call of response.toolCalls) {
      calls++
      // Announced before it runs, so the interface can say what is happening
      // rather than showing a spinner for the four seconds a lookup takes.
      yield { type: 'step', tool: call.name }

      const result = await execute(input, call, proposals)
      if (!used.includes(call.name)) used.push(call.name)
      trace.push(traced(call, result))
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify(result.value),
      })
    }
  }

  messages.push({
    role: 'user',
    content:
      'You have run out of lookups. Answer now with what you already have, and say plainly what you could not check.',
  })

  const last = invokeStream(
    { actor, branchId, surface: 'assistant', promptVersion: ASSISTANT_PROMPT_VERSION },
    { surface: 'assistant', messages, maxOutputTokens: 1_000 },
  )

  let piece = await last.next()
  while (!piece.done) {
    yield { type: 'text', text: piece.value }
    piece = await last.next()
  }

  if (piece.value) {
    invocationIds.push(piece.value.invocationId)
    const text = piece.value.response.text.trim()
    if (text) said.push(text)
  }

  yield {
    type: 'done',
    reply: answer(),
    proposals,
    used,
    calls: trace,
    invocationIds,
    truncated: 'turns',
  }
}

/* -------------------------------------------------------------------------
 * One tool call
 * ---------------------------------------------------------------------- */

interface Executed {
  readonly args: ToolArgs
  readonly value: unknown
}

function traced(call: ModelToolCall, result: Executed): ToolTrace {
  return {
    id: call.id,
    name: call.name,
    args: result.args,
    result: keepable(result.value),
    at: new Date().toISOString(),
  }
}

/**
 * Run a read, or build a proposal — never both, and never a write.
 *
 * A failure is returned to the model as data rather than thrown, and that is
 * the difference between an assistant that says *"there is no shipment
 * KWI-JOB-2026-99999"* and one that says *"something went wrong"*. Every
 * refusal in `proposeTransition` is already phrased for a person to read; this
 * hands that sentence straight back so the model can relay it rather than
 * paraphrasing an exception.
 */
async function execute(
  input: AssistantQuestion,
  call: ModelToolCall,
  proposals: TransitionProposal[],
): Promise<Executed> {
  let args: ToolArgs = {}
  try {
    args = JSON.parse(call.arguments || '{}') as ToolArgs
  } catch {
    return { args, value: { error: 'Those arguments were not valid JSON. Try again.' } }
  }

  const declared = assistantTool(call.name)
  if (!declared) {
    return { args, value: { error: `There is no tool called ${call.name}.` } }
  }

  /*
    Checked again here, not only when the tool list was built.

    The list offered is the list the model *should* use, and a model may name
    a tool it was never given — from a previous turn, from its training, or
    because a user asked it to. The gate has to be at the call.
  */
  if (declared.requires && !input.permissions.has(declared.requires)) {
    return { args, value: { error: 'You do not have permission to do that.' } }
  }

  /*
    Closed parameters held to their enums before anything runs (ai-1). A
    refusal goes back as data naming the values that would work, so the model's
    next turn is a corrected call rather than an empty list reported as fact.
  */
  const normalised = normaliseToolArgs(declared, args)
  if (!normalised.ok) return { args, value: { error: normalised.error } }
  args = normalised.args

  if (declared.kind === 'propose') {
    return { args, value: await propose(input, args, proposals) }
  }

  try {
    const value = await runTool(input.actor, call.name, args)
    /*
      The label beside every code, in the answer's language. A model shown only
      `in_transit` writes `in_transit` — a live Arabic answer put it in a table
      under Arabic headings — and the prompt can only say "use the label" if
      there is one to use.
    */
    return {
      args,
      value: declared.labels
        ? withLabels(value, declared.labels, answerLanguage(input.question, input.locale))
        : value,
    }
  } catch (error) {
    return {
      args,
      value: { error: error instanceof Error ? error.message : 'That lookup failed.' },
    }
  }
}

/**
 * Turn a suggested transition into an offer, or explain why not.
 *
 * The record's state is read here rather than taken from the model's argument,
 * which is the whole reason this is not a one-liner: a model that has been
 * told a shipment is `arrived` will happily propose `arrived -> delivered`
 * against a record that moved to `on_hold` ten minutes ago. Reading the state
 * back is what makes the button that appears a button that will work.
 */
async function propose(
  input: AssistantQuestion,
  args: ToolArgs,
  proposals: TransitionProposal[],
): Promise<unknown> {
  const entity = String(args.entity ?? '')
  const reference = String(args.reference ?? '')
  const to = String(args.to ?? '')
  const reason = typeof args.reason === 'string' ? args.reason : undefined

  if (!isProposableEntity(entity)) {
    return { error: `There is nothing called a ${entity} to move.` }
  }

  const record =
    entity === 'customs'
      ? await currentCustomsState(input.actor, reference)
      : await currentState(input.actor, entity, reference)

  if (!record) {
    return { error: `No ${entity} ${reference} — check the reference.` }
  }

  try {
    const proposal = proposeTransition({
      entity,
      reference,
      targetId: record.id,
      from: record.state,
      to,
      reason,
      permissions: input.permissions,
    })

    /*
      Deduplicated on the target and destination.

      A model that proposes the same move twice in one answer — which happens
      when it re-reads a record after a failed first attempt — would otherwise
      put two identical buttons in front of a coordinator, and pressing the
      second after the first is a refused transition and a confusing error.
    */
    const already = proposals.some(
      (existing) =>
        existing.entity === proposal.entity &&
        existing.reference === proposal.reference &&
        existing.to === proposal.to,
    )
    if (!already) proposals.push(proposal)

    return {
      proposed: true,
      note: 'Offered to the person for confirmation. It has NOT been done.',
      from: proposal.from,
      to: proposal.to,
      label: proposal.label,
    }
  } catch (error) {
    if (error instanceof AiError) {
      /*
        The refusal, plus what *would* be legal from here.

        A model told only "that is not allowed" guesses again. One told the
        record is in `arrived` and may go to `customs` or `delivered` proposes
        one of those, and the coordinator sees a usable button on the first
        turn rather than the third.
      */
      const options = proposableTransitions(entity, record.state, input.permissions)
      return {
        error: error.message,
        currentState: record.state,
        allowed: options.map((option) => ({ to: option.to, label: option.label })),
      }
    }
    throw error
  }
}
