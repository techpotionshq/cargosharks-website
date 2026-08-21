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
  proposableTransitions,
  proposeTransition,
  toolsFor,
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
   * Earlier turns, oldest first.
   *
   * Plain text only. Tool calls and their results are deliberately *not*
   * carried across turns: they are the largest thing in the transcript, they
   * go stale the moment anything moves, and a model reasoning from last
   * Tuesday's row counts will state them as today's. Re-asking is cheap and
   * correct; remembering is neither.
   */
  readonly history?: readonly { role: 'user' | 'assistant'; content: string }[]
}

export interface AssistantAnswer {
  readonly reply: string
  /** Actions offered to the person. Nothing has been done. */
  readonly proposals: readonly TransitionProposal[]
  /** What was looked at, so the interface can show its working. */
  readonly used: readonly { name: string; args: ToolArgs }[]
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
    { role: 'system', content: assistantSystemPrompt(locale) },
    ...(input.history ?? []).map((turn) => ({ role: turn.role, content: turn.content }) as const),
    { role: 'user', content: question },
  ]

  const tools = wireTools(permissions)
  const proposals: TransitionProposal[] = []
  const used: { name: string; args: ToolArgs }[] = []
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
      return { reply: answer(), proposals, used, invocationIds }
    }

    if (response.toolCalls.length === 0) {
      if (response.text.trim()) said.push(response.text.trim())
      return { reply: answer(), proposals, used, invocationIds }
    }

    if (calls + response.toolCalls.length > ASSISTANT_LIMITS.maxToolCalls) {
      if (response.text.trim()) said.push(response.text.trim())
      return { reply: answer(), proposals, used, invocationIds, truncated: 'tool_calls' }
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

  return { reply: answer(), proposals, used, invocationIds, truncated: 'turns' }
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
    { role: 'system', content: assistantSystemPrompt(locale) },
    ...(input.history ?? []).map((turn) => ({ role: turn.role, content: turn.content }) as const),
    { role: 'user', content: question },
  ]

  const tools = wireTools(permissions)
  const proposals: TransitionProposal[] = []
  const used: string[] = []
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
      yield { type: 'done', reply: answer(), proposals, used, invocationIds }
      return
    }

    if (calls + response.toolCalls.length > ASSISTANT_LIMITS.maxToolCalls) {
      yield {
        type: 'done',
        reply: answer(),
        proposals,
        used,
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

  yield { type: 'done', reply: answer(), proposals, used, invocationIds, truncated: 'turns' }
}

/* -------------------------------------------------------------------------
 * One tool call
 * ---------------------------------------------------------------------- */

interface Executed {
  readonly args: ToolArgs
  readonly value: unknown
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

  if (declared.kind === 'propose') {
    return { args, value: await propose(input, args, proposals) }
  }

  try {
    return { args, value: await runTool(input.actor, call.name, args) }
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
