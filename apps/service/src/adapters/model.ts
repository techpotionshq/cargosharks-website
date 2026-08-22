/**
 * The model provider — `ModelProvider` in `ports/index.ts`.
 *
 * OpenRouter, which is deliberately a router rather than a model vendor. That
 * choice buys the one property this deployment actually needs: the model is a
 * *setting*, so changing which model reads a customs declaration is something
 * the person paying for it does on a screen, not something we release. It also means the named second implementation in §10
 * — a model hosted inside the Gulf — is reachable without rewriting any of
 * the surfaces, because they all speak to this interface.
 *
 * ## Three things this file does not do
 *
 * **It does not retry.** pg-boss already retries with exponential backoff and
 * keeps failures for a month (`queue.ts`), and every surface that calls a
 * model runs inside a job for exactly that reason. A retry loop here would
 * multiply against that one and turn a rate-limit into a spend incident.
 *
 * **It does not write the ledger.** `ai_invocations` is written by the caller,
 * once, around this call — see `workers/ai.ts`. Recording the cost is not a
 * per-provider concern and putting it here would mean writing it again for
 * the second implementation.
 *
 * **It does not know what a proposal is.** It returns text and token counts.
 * Whether the text is admissible, whether it may overwrite a column, and what
 * it cost are `core/ai.ts`'s problem, where they can be tested without a key.
 *
 * ## Nothing here is billed by accident
 *
 * The driver defaults to `none`, like tracking and transmission and for the
 * same reason: this is a metered external cost, and a deployment that has not
 * decided to spend money should not start spending it because a variable was
 * left in an example file. It is the only integration in the catalogue whose
 * unit is a *document* rather than a container or a message, which is why the
 * spend ceiling sits beside the key rather than in a runbook.
 *
 * Configuration is the `ai` row in `integration_settings`, over the
 * environment beneath it — the layering `settings.ts` argues for. That matters
 * more here than anywhere else in the catalogue: a model slug is repriced and
 * deprecated on someone else's schedule, and neither event should need us.
 */

import type {
  ModelContent,
  ModelDelta,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
} from '../ports/index'
import { DEFAULT_MODEL } from '@qabandi/core'
import { config } from '../config'
import type { LiveIntegration } from '../settings'

/**
 * OpenRouter's endpoint. A constant, not a setting.
 *
 * It was a setting for one revision and it should not have been: nobody
 * deploying this changes it, and a URL a client can mistype is a support call
 * whose symptom is "the AI stopped working". A second provider is a second
 * implementation of the port, which is where that variation belongs.
 */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1'

/**
 * How long one call may take.
 *
 * Sixty seconds, which is long for a request and right for this one: a
 * multi-page scan legitimately takes tens of seconds, and these run inside
 * pg-boss jobs where nobody is watching a spinner. A constant rather than a
 * knob, because the number is a property of what a scan takes to read and not
 * of the deployment reading it.
 */
const TIMEOUT_MS = 60_000

export class ModelError extends Error {
  readonly code: string
  /** The provider's HTTP status, where there was one. */
  readonly status?: number

  constructor(code: string, message: string, status?: number) {
    super(message)
    this.name = 'ModelError'
    this.code = code
    this.status = status
  }
}

/* -------------------------------------------------------------------------
 * The Release One behaviour, kept as a real implementation
 * ---------------------------------------------------------------------- */

/**
 * No model configured — and that is a decision, not a fault.
 *
 * It refuses rather than returning an empty result, which is the opposite of
 * `manualFxSource`, and the difference is worth stating. A missing FX feed
 * means rates arrive by hand and the system is complete without it. A missing
 * model means the caller is about to record an extraction that never
 * happened, and silently returning "no fields found" would be indistinguishable
 * from a document with no fields in it.
 *
 * Callers check `available` before asking. Nothing in this system is allowed
 * to *require* a model.
 */
const unconfigured = (): ModelError =>
  new ModelError(
    'model.not_configured',
    'No model provider is configured. Add an OpenRouter key on Settings → Integrations.',
  )

export const noModel: ModelProvider = {
  key: 'none',
  available: false,
  complete: () => Promise.reject(unconfigured()),
  // eslint-disable-next-line require-yield
  async *stream() {
    throw unconfigured()
  },
}

/* -------------------------------------------------------------------------
 * OpenRouter
 * ---------------------------------------------------------------------- */

/** The shape of what comes back. Narrow, and every field optional-safe. */
interface ChatCompletion {
  readonly model?: string
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null
      /** Where `minimax/minimax-m3` sometimes puts the whole answer. See `reasoningText`. */
      readonly reasoning?: string | null
      readonly tool_calls?: readonly {
        readonly id?: string
        readonly function?: { readonly name?: string; readonly arguments?: string }
      }[]
    }
    readonly finish_reason?: string
  }[]
  readonly usage?: {
    readonly prompt_tokens?: number
    readonly completion_tokens?: number
    /** OpenRouter reports the credit cost here when asked to. */
    readonly cost?: number
  }
  readonly error?: { readonly message?: string; readonly code?: number | string }
}

export interface OpenRouterOptions {
  readonly apiKey: string
  readonly baseUrl: string
  /** The slug this surface asked for, e.g. a vendor/model pair. */
  readonly model: string
  readonly timeoutMs: number
  /**
   * Sent as `HTTP-Referer` and `X-Title`.
   *
   * OpenRouter uses these to attribute traffic on its own dashboard, which is
   * how the person paying the bill tells this deployment's spend apart from
   * anything else on the same key. Optional to the API and not optional to
   * anyone trying to reconcile an invoice.
   */
  readonly appUrl?: string
  readonly appTitle?: string
}

/**
 * A chat completion, in the OpenAI-compatible shape OpenRouter serves.
 *
 * Written directly against `fetch` rather than through a vendor SDK, on the
 * same reasoning `apiKeys` gives for not importing Better Auth's plugin: it
 * is about a hundred lines, the request shape is the most stable contract in
 * this industry, and the failure modes are ours to reason about. An SDK here
 * would add a dependency that upgrades on someone else's schedule to save
 * roughly forty lines of JSON.
 */
export function openRouterModel(options: OpenRouterOptions): ModelProvider {
  return {
    key: `openrouter:${options.model}`,
    available: true,

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const response = await send(options, request, false)
      const raw: unknown = await response.json().catch(() => null)
      return readCompletion(raw as ChatCompletion, options.model)
    },

    /**
     * The same call, read as it arrives.
     *
     * Tool calls are accumulated rather than streamed onward: a caller cannot
     * act on half an argument list, and the loop needs the whole thing before
     * it can run anything. Text is yielded the moment it appears, which is the
     * only part a person can use early.
     */
    async *stream(request: ModelRequest): AsyncIterable<ModelDelta> {
      const response = await send(options, request, true)
      yield* readStream(response, options.model)
    },
  }
}

/** The request body and the POST, shared by both methods. */
async function send(
  options: OpenRouterOptions,
  request: ModelRequest,
  streaming: boolean,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: request.messages.map(toWireMessage),
    /*
    Zero by default. Every surface here reads a fact that is either on
    the page or is not, and sampling would trade reproducibility — the
    thing the golden set depends on — for variety nobody wants.
  */
    temperature: request.temperature ?? 0,
    /*
    Ask the router to report what the call cost.

    Without this the response carries token counts and no price, and
    pricing them ourselves means holding a table of per-model rates that
    goes stale silently. `costOf` in core still has that table as a
    fallback, because a provider that stops reporting should degrade to
    an estimate rather than to zero — and zero is what an absent cost
    looks like in a monthly sum.
  */
    usage: { include: true },
  }

  if (streaming) body.stream = true

  if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens

  if (request.schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'extraction', strict: true, schema: request.schema },
    }
  }

  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  let response: Response
  try {
    response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        ...(options.appUrl ? { 'http-referer': options.appUrl } : {}),
        ...(options.appTitle ? { 'x-title': options.appTitle } : {}),
      },
      body: JSON.stringify(body),
      /*
      A timeout, because there is no such thing as a request without
      one — the same sentence `fx.ts` writes, and the same reasoning.
      This runs inside a worker, so a hang does not look like a slow
      page; it looks like a worker that quietly stopped doing its other
      work, which is far harder to notice.
    */
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new ModelError(
      timedOut ? 'model.timeout' : 'model.unreachable',
      timedOut
        ? `The model did not answer within ${options.timeoutMs}ms.`
        : `Could not reach the model provider: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  /*
  Only read on failure. A streaming response's body is the stream, and
  consuming it here to look for an error would leave nothing to iterate.
*/
  const raw: unknown = response.ok ? null : await response.json().catch(() => null)

  if (!response.ok) {
    const message = (raw as ChatCompletion | null)?.error?.message ?? `HTTP ${response.status}`
    /*
    402 and 429 are named rather than lumped in with "the provider said
    no", because they are the two an operator can actually act on and
    they are the two that arrive at the worst moment. Out of credit and
    rate-limited both stop extraction; only one of them is fixed by
    waiting, and a log that cannot tell them apart sends somebody to
    check the wrong thing at 2am.
  */
    const code =
      response.status === 402
        ? 'model.out_of_credit'
        : response.status === 429
          ? 'model.rate_limited'
          : 'model.refused'
    throw new ModelError(code, message, response.status)
  }

  return response
}

/**
 * The provider's body, turned into our shape.
 *
 * Exported for the tests, which is the only way the parsing of a response
 * gets exercised without a key: the shapes that break this — a null content
 * with tool calls beside it, a missing `usage`, a choice array of length zero
 * — are all ordinary, and all of them arrive from a live provider rather than
 * from a fixture unless somebody writes one.
 */
export function readCompletion(payload: ChatCompletion, requested: string): ModelResponse {
  const choice = payload.choices?.[0]

  if (!choice) {
    throw new ModelError('model.empty_response', 'The provider returned no choices.')
  }

  const toolCalls: ModelToolCall[] = (choice.message?.tool_calls ?? []).flatMap((call) =>
    call.function?.name
      ? [
          {
            id: call.id ?? call.function.name,
            name: call.function.name,
            arguments: call.function.arguments ?? '{}',
          },
        ]
      : [],
  )

  return {
    // What answered, falling back to what was asked for. Both are recorded.
    model: payload.model ?? requested,
    /*
      Null content is normal, not an error — with one exception found live.

      A response that is entirely tool calls carries `content: null`, and a
      caller reading `.text` on that would get "null" as a string if this
      coerced. The empty string is the honest answer: the model said nothing
      in words.

      The exception: `minimax/minimax-m3`, asked for structured output,
      intermittently returns `content: null` with the *entire* JSON answer in
      `message.reasoning` — nine "reasoning" tokens that are the answer, and
      nothing else. Read as `''`, that became "The model returned nothing",
      which looked like a transient provider fault, was retried five times at
      full price, and failed identically each time. It was never transient. So
      where there is no content and no tool call but there is reasoning text,
      the reasoning *is* the reply. A model that genuinely reasoned and then
      answered has content, and is unaffected.
    */
    text: choice.message?.content ?? (toolCalls.length === 0 ? reasoningText(choice.message) : ''),
    toolCalls,
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
    /*
      Cost crosses into the system as a string and stays one.

      The provider sends a JSON number, which is the one place a float is
      unavoidable, so it is converted at the boundary and never added as a
      number. `toFixed(6)` matches `numeric(19,6)`; `String(0.0000001)` would
      arrive as `1e-7` and lose to `numeric` on the way in.
    */
    costUsd: typeof payload.usage?.cost === 'number' ? payload.usage.cost.toFixed(6) : undefined,
    finishReason: readFinishReason(choice.finish_reason),
    raw: payload,
  }
}

/**
 * The reply, when a model put it in `reasoning` instead of `content`.
 *
 * Only consulted where `content` is null and no tool was called — a model
 * that reasoned *and then* answered has content, and its reasoning stays
 * where it belongs. See the comment at `text` in `toResponse`.
 */
function reasoningText(message: { readonly reasoning?: string | null } | undefined): string {
  return typeof message?.reasoning === 'string' ? message.reasoning : ''
}

function readFinishReason(reason: string | undefined): ModelResponse['finishReason'] {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason
    /*
      An unrecognised reason is `error`, not `stop`.

      Providers invent these — `end_turn`, `max_tokens`, `refusal`, `null`
      during a stream — and the safe reading of one we do not know is that
      the response may be incomplete. Calling it `stop` would let a truncated
      extraction be applied as if it were whole.
    */
    default:
      return 'error'
  }
}

/** Our message shape, in the wire's. */
function toWireMessage(message: ModelMessage): Record<string, unknown> {
  const content =
    typeof message.content === 'string' ? message.content : message.content.map(toWirePart)

  /*
    A tool result names the call it answers.

    Without `tool_call_id` the provider cannot pair the result with the
    request, and the usual symptom is not an error — it is a model that asks
    for the same tool again because, as far as it can tell, nothing came back.
  */
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content }
  }

  if (message.toolCalls?.length) {
    return {
      role: message.role,
      content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    }
  }

  return { role: message.role, content }
}

function toWirePart(part: ModelContent): Record<string, unknown> {
  if (part.type === 'text') return { type: 'text', text: part.text }

  /*
    A data URI, never a link — see `ModelContent` in the port.

    Refused here rather than trusted, because this is the last place that can
    tell: by the time the request is on the wire, an `https://` in this field
    is a fetch the provider makes on our behalf against a URL that came out of
    a document we did not write.
  */
  if (!part.dataUri.startsWith('data:')) {
    throw new ModelError(
      'model.remote_image',
      'Attachments must be inlined as data URIs; a URL would make the provider fetch it.',
    )
  }

  if (part.type === 'image') return { type: 'image_url', image_url: { url: part.dataUri } }

  /*
    PDF, in OpenRouter's `file` part.

    **Verified** — `Integration_Landscape.md`'s tag, earned rather than assumed:
    `pnpm --filter @qabandi/service verify:model` generates a supplier invoice,
    sends it through this exact path against a live key, and checks that what
    came back reconciles. `Operations_Findings.md` is the reason that script
    exists — two integrations here were written against documentation and both
    were wrong in ways one real call caught immediately.

    A provider that wants a different field name answers 400 with a message,
    `ModelError` carries it through to `ai_invocations.error`, and the
    extraction records that it could not run. It does not silently return an
    empty invoice, which is the failure that would matter.
  */
  return {
    type: 'file',
    file: { filename: part.filename, file_data: part.dataUri },
  }
}

/* -------------------------------------------------------------------------
 * Reading a stream
 * ---------------------------------------------------------------------- */

/** One server-sent chunk, in the shape the streaming API sends. */
interface ChatChunk {
  readonly model?: string
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string | null
      /** Where `minimax/minimax-m3` sometimes puts the whole answer. See `reasoningText`. */
      readonly reasoning?: string | null
      readonly tool_calls?: readonly {
        readonly index?: number
        readonly id?: string
        readonly function?: { readonly name?: string; readonly arguments?: string }
      }[]
    }
    readonly finish_reason?: string
  }[]
  readonly usage?: {
    readonly prompt_tokens?: number
    readonly completion_tokens?: number
    readonly cost?: number
  }
}

/**
 * Server-sent events, turned into deltas and one assembled response.
 *
 * Three things here are not obvious and all three are the difference between
 * this working and appearing to work.
 *
 * **A chunk can be split across TCP reads.** `data: {"cho` and the rest can
 * arrive separately, so the tail of a read is held back until a blank line
 * proves an event is complete. Parsing per read instead drops content
 * intermittently under exactly the conditions that matter — a long answer on a
 * slow connection.
 *
 * **Tool calls arrive in pieces, keyed by index.** The name comes in one
 * chunk, the arguments in a dozen more, and they are only identified by
 * position in an array. They are merged by `index` rather than appended,
 * because appending produces one malformed call per fragment.
 *
 * **Usage arrives last, in its own chunk, after `finish_reason`.** Stopping at
 * the finish reason loses the token counts and the cost, which is the whole
 * ledger — so the loop runs to `[DONE]` rather than to the first finish.
 */
export async function* readStream(
  response: Response,
  requested: string,
): AsyncIterable<ModelDelta> {
  const body = response.body
  if (!body) throw new ModelError('model.empty_response', 'The provider returned no stream.')

  const decoder = new TextDecoder()
  const reader = body.getReader()

  let buffered = ''
  let text = ''
  let reasoning = ''
  let model = requested
  let finish: string | undefined
  let usage: ChatChunk['usage']
  const calls = new Map<number, { id: string; name: string; arguments: string }>()

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffered += decoder.decode(value, { stream: true })

      // Events are separated by a blank line; anything after the last one is
      // an incomplete event and waits for the next read.
      const events = buffered.split(/\r?\n\r?\n/)
      buffered = events.pop() ?? ''

      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '' || payload === '[DONE]') continue

          let chunk: ChatChunk
          try {
            chunk = JSON.parse(payload) as ChatChunk
          } catch {
            // A comment or a keep-alive rather than an event. Providers send
            // these to hold the connection open and they are not errors.
            continue
          }

          if (chunk.model) model = chunk.model
          if (chunk.usage) usage = chunk.usage

          const choice = chunk.choices?.[0]
          if (choice?.finish_reason) finish = choice.finish_reason

          const piece = choice?.delta?.content
          if (piece) {
            text += piece
            yield { type: 'text', text: piece }
          }
          /*
            Kept aside, never streamed. A model's reasoning is not the reply
            and must not be shown as one — unless, at the end, it is all the
            model sent. See `reasoningText`.
          */
          const thought = choice?.delta?.reasoning
          if (typeof thought === 'string') reasoning += thought

          for (const partial of choice?.delta?.tool_calls ?? []) {
            const index = partial.index ?? 0
            const existing = calls.get(index) ?? { id: '', name: '', arguments: '' }
            calls.set(index, {
              id: partial.id ?? existing.id,
              name: partial.function?.name ?? existing.name,
              arguments: existing.arguments + (partial.function?.arguments ?? ''),
            })
          }
        }
      }
    }
  } finally {
    // Releases the connection when a consumer stops iterating early — a person
    // closing the panel mid-answer would otherwise hold a socket until the
    // model finished talking to nobody.
    reader.cancel().catch(() => {})
  }

  const toolCalls: ModelToolCall[] = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, call]) => call.name)
    .map(([index, call]) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: call.arguments || '{}',
    }))

  // The same fallback the non-streaming path makes, at the same point.
  if (text === '' && toolCalls.length === 0 && reasoning.trim() !== '') text = reasoning

  yield {
    type: 'final',
    response: {
      model,
      text,
      toolCalls,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      costUsd: typeof usage?.cost === 'number' ? usage.cost.toFixed(6) : undefined,
      /*
        A stream that ended without saying why is `stop` only if it produced
        something. Nothing at all is `error`, on the same reasoning
        `readFinishReason` gives: an unrecognised ending may be a truncated
        answer, and calling it a clean stop lets half a sentence be applied as
        if it were whole.
      */
      finishReason: finish
        ? readFinishReason(finish)
        : text || toolCalls.length > 0
          ? 'stop'
          : 'error',
      raw: { streamed: true, model, text, toolCalls, usage },
    },
  }
}

/* -------------------------------------------------------------------------
 * Resolution
 * ---------------------------------------------------------------------- */

/**
 * The provider this deployment is wired to.
 *
 * Resolved per call from rows rather than memoised at boot, on exactly the
 * reasoning `settings.ts` gives — a key pasted at 09:05 must work at 09:06,
 * and a model changed on a screen must take effect without a restart. The
 * thirty-second snapshot cache behind `integration()` keeps that from being a
 * query per document.
 *
 * No surface parameter, and no driver check. There is one model, and the key
 * decides whether there is a provider at all.
 */
export function modelProviderFrom(settings: LiveIntegration): ModelProvider {
  const apiKey = settings.secret('apiKey')
  if (!apiKey) return noModel

  return openRouterModel({
    apiKey,
    baseUrl: OPENROUTER_URL,
    /*
      A deployment's own slug, or the verified default. Whatever it is, it must
      accept image input — every surface here reads a scan, and a text-only
      model answers the prompt having seen nothing.
    */
    model: settings.text('model') || DEFAULT_MODEL,
    timeoutMs: TIMEOUT_MS,
    appUrl: config.WEB_URL,
    appTitle: 'Qabandi',
  })
}

/**
 * The monthly ceiling this deployment has set, in USD. `0` is no ceiling.
 *
 * Read from the same row as the key, because a budget is a property of the
 * account being billed and not of the process reading it.
 */
export function monthlyBudgetUsd(settings: LiveIntegration): number {
  return settings.number('monthlyBudgetUsd', 0)
}
