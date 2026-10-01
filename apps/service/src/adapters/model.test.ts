/**
 * The model adapter, against a stubbed `fetch`.
 *
 * What is checked here is the half that breaks against a live provider rather
 * than against a fixture: a response whose content is null because the model
 * answered entirely in tool calls, a `usage` block that is absent, a finish
 * reason nobody has heard of, and the two HTTP statuses an operator can
 * actually act on. All four are ordinary, none of them throws on its own, and
 * every one of them ends as a silently wrong extraction if read carelessly.
 *
 * No environment and no settings row: `openRouterModel` takes its options as
 * an argument, which is what lets this run in CI with no OpenRouter account.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelError, openRouterModel, readCompletion } from './model'
import type { ModelRequest } from '../ports/index'

const options = {
  apiKey: 'sk-test',
  baseUrl: 'https://openrouter.example/api/v1',
  model: 'vendor/model-a',
  timeoutMs: 5_000,
  appUrl: 'https://qabandi.example',
  appTitle: 'Qabandi',
}

const ask = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  surface: 'enquiry_extract',
  messages: [{ role: 'user', content: 'Read this enquiry.' }],
  ...over,
})

const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const completion = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  model: 'vendor/model-a',
  choices: [{ message: { content: '{"mode":"sea"}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0031 },
  ...over,
})

let calls: { url: string; init: RequestInit }[]

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return Promise.resolve(respond(completion()))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const body = (): Record<string, unknown> =>
  JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>

describe('the request', () => {
  it('posts to the chat endpoint with the key and the attribution headers', async () => {
    await openRouterModel(options).complete(ask())

    expect(calls[0]!.url).toBe('https://openrouter.example/api/v1/chat/completions')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
    // Attribution, so the person paying can tell this deployment's spend apart.
    expect(headers['http-referer']).toBe('https://qabandi.example')
    expect(headers['x-title']).toBe('Qabandi')
  })

  it('does not double the slash when the base URL has a trailing one', async () => {
    await openRouterModel({ ...options, baseUrl: 'https://openrouter.example/api/v1/' }).complete(
      ask(),
    )
    expect(calls[0]!.url).toBe('https://openrouter.example/api/v1/chat/completions')
  })

  /*
    Zero, and asked for explicitly rather than left to the provider's default.
    Every surface here reads a fact that is either on the page or is not, and
    the golden set only means something week to week if the call is repeatable.
  */
  it('defaults the temperature to zero and asks for the cost', async () => {
    await openRouterModel(options).complete(ask())
    expect(body().temperature).toBe(0)
    expect(body().usage).toEqual({ include: true })
  })

  it('sends a schema as strict structured output when one is given', async () => {
    await openRouterModel(options).complete(
      ask({ schema: { type: 'object', properties: { mode: { type: 'string' } } } }),
    )
    const format = body().response_format as Record<string, Record<string, unknown>>
    expect(format.type).toBe('json_schema')
    expect(format.json_schema!.strict).toBe(true)
  })

  it('omits max_tokens entirely rather than sending a guess', async () => {
    await openRouterModel(options).complete(ask())
    expect('max_tokens' in body()).toBe(false)
  })

  /*
    The security property on `ModelContent`, enforced at the last place that
    can tell. A URL here would make the provider fetch it — turning "extract
    this bill of lading" into a request we did not make, against an address
    that came out of a document we did not write.
  */
  it('refuses an image that is a link rather than bytes', async () => {
    const remote = ask({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', dataUri: 'https://evil.example/logo.png' }],
        },
      ],
    })

    await expect(openRouterModel(options).complete(remote)).rejects.toThrow(/data URIs/)
    expect(calls).toHaveLength(0)
  })

  it('sends an inlined image as an image part', async () => {
    await openRouterModel(options).complete(
      ask({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this waybill.' },
              { type: 'image', dataUri: 'data:image/png;base64,AAAA' },
            ],
          },
        ],
      }),
    )

    const messages = body().messages as { content: { type: string }[] }[]
    expect(messages[0]!.content.map((part) => part.type)).toEqual(['text', 'image_url'])
  })
})

describe('the response', () => {
  it('reads text, tokens and the reported cost', async () => {
    const result = await openRouterModel(options).complete(ask())

    expect(result.text).toBe('{"mode":"sea"}')
    expect(result.inputTokens).toBe(900)
    expect(result.outputTokens).toBe(40)
    expect(result.costUsd).toBe('0.003100')
    expect(result.finishReason).toBe('stop')
  })

  /*
    Cost crosses in as a JSON number — the one place a float is unavoidable —
    and leaves as a string at `numeric(19,6)`. `String(0.0000001)` would arrive
    as `1e-7` and lose to `numeric` on the way in.
  */
  it('formats a tiny cost for numeric rather than in exponent notation', () => {
    const result = readCompletion(
      completion({ usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0000001 } }) as never,
      'vendor/model-a',
    )
    expect(result.costUsd).toBe('0.000000')
    expect(result.costUsd).not.toMatch(/e/i)
  })

  it('records which model actually answered when the router substitutes one', () => {
    const result = readCompletion(
      completion({ model: 'vendor/model-b' }) as never,
      'vendor/model-a',
    )
    expect(result.model).toBe('vendor/model-b')
  })

  it('falls back to what was asked for when the provider names nothing', () => {
    const result = readCompletion(completion({ model: undefined }) as never, 'vendor/model-a')
    expect(result.model).toBe('vendor/model-a')
  })

  /*
    A response that is entirely tool calls carries `content: null`. Coercing
    would hand the caller the string "null" to parse.
  */
  it('reads a null content as no words rather than as the word null', () => {
    const result = readCompletion(
      completion({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'c1', function: { name: 'openJobs', arguments: '{"branch":"KWI"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }) as never,
      'vendor/model-a',
    )

    expect(result.text).toBe('')
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'openJobs', arguments: '{"branch":"KWI"}' },
    ])
  })

  /*
    `Operations_Findings` §11, OP-31: the answer can arrive in `reasoning` with
    no content. The provider sends that as `null` *and* as `""`, and only the
    first used to fall through — the second read as "the model returned
    nothing" and was retried five times at full price.
  */
  it('reads the reply from reasoning when content is empty, not only when it is null', () => {
    for (const content of [null, '', '  ']) {
      const result = readCompletion(
        completion({
          choices: [{ message: { content, reasoning: '{"mode":"sea"}' }, finish_reason: 'stop' }],
        }) as never,
        'vendor/model-a',
      )
      expect(result.text).toBe('{"mode":"sea"}')
    }
  })

  it('keeps real content over reasoning', () => {
    const result = readCompletion(
      completion({
        choices: [
          { message: { content: '{"mode":"air"}', reasoning: 'thinking…' }, finish_reason: 'stop' },
        ],
      }) as never,
      'vendor/model-a',
    )
    expect(result.text).toBe('{"mode":"air"}')
  })

  it('treats a missing usage block as zero tokens and no cost, not as a crash', () => {
    const result = readCompletion(completion({ usage: undefined }) as never, 'vendor/model-a')
    expect(result.inputTokens).toBe(0)
    expect(result.costUsd).toBeUndefined()
  })

  /*
    The one that matters most. Providers invent finish reasons, and reading an
    unknown one as `stop` lets a truncated extraction be applied as if it were
    whole.
  */
  it('reads an unrecognised finish reason as an error, never as stop', () => {
    for (const reason of ['end_turn', 'max_tokens', 'refusal', undefined]) {
      const result = readCompletion(
        completion({ choices: [{ message: { content: '{}' }, finish_reason: reason }] }) as never,
        'vendor/model-a',
      )
      expect(result.finishReason).toBe('error')
    }
  })

  it('refuses a response with no choices at all', () => {
    expect(() => readCompletion(completion({ choices: [] }) as never, 'vendor/model-a')).toThrow(
      ModelError,
    )
  })
})

describe('failures an operator can act on', () => {
  const failWith = (status: number, message: string): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respond({ error: { message } }, status))),
    )
  }

  /*
    Out of credit and rate-limited both stop extraction, and only one of them
    is fixed by waiting. A log that cannot tell them apart sends somebody to
    check the wrong thing at 2am.
  */
  it('names an exhausted balance distinctly from a rate limit', async () => {
    failWith(402, 'Insufficient credits')
    await expect(openRouterModel(options).complete(ask())).rejects.toMatchObject({
      code: 'model.out_of_credit',
      status: 402,
    })

    failWith(429, 'Rate limit exceeded')
    await expect(openRouterModel(options).complete(ask())).rejects.toMatchObject({
      code: 'model.rate_limited',
    })
  })

  it('carries the provider’s own message through rather than an HTTP number', async () => {
    failWith(400, 'model `vendor/typo` is not a valid model ID')
    await expect(openRouterModel(options).complete(ask())).rejects.toThrow(/not a valid model ID/)
  })

  it('still fails usefully when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 502 }))),
    )
    await expect(openRouterModel(options).complete(ask())).rejects.toThrow(/HTTP 502/)
  })

  it('reports an unreachable provider as unreachable, not as a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    )
    await expect(openRouterModel(options).complete(ask())).rejects.toMatchObject({
      code: 'model.unreachable',
    })
  })

  it('reports a timeout as a timeout, with the budget it exceeded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const error = new Error('The operation was aborted due to timeout')
        error.name = 'TimeoutError'
        return Promise.reject(error)
      }),
    )
    await expect(openRouterModel(options).complete(ask())).rejects.toThrow(/within 5000ms/)
  })
})
