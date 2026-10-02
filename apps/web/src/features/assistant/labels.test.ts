/**
 * The labels are data, and nothing here may be a function.
 *
 * This exists because the obvious mistake was made and shipped: `tool(name)`
 * and `checking(label)` were passed as functions from a server component into
 * a client one. Props crossing that boundary are serialised, a function has no
 * serialisation, and the result was not a missing label — it was a whole-screen
 * error boundary reading *"Functions cannot be passed directly to Client
 * Components"*.
 *
 * TypeScript could not see it: a function is a perfectly good property type.
 * Only the runtime boundary objects, and only when a person opens the page. So
 * the check lives here, where it costs a millisecond.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ASSISTANT_TOOLS, LABELS, LABEL_SOURCES } from '@qabandi/core'
import { assistantLabels } from './labels'

/*
  Read, not imported.

  `check-boundaries.mjs` scans import specifiers and reads `../../../messages`
  as a reach into another slice, which it is not — the catalogues are
  application data, and the checker's path heuristic cannot tell the difference.
  Reading the file says what is actually happening: this is a fixture, not a
  module dependency, and nothing in the slice graph changes because of it.
*/
const MESSAGES = join(dirname(fileURLToPath(import.meta.url)), '../../../messages')

const catalogueFor = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), 'utf8')) as Record<string, unknown>

const en = catalogueFor('en')
const ar = catalogueFor('ar')

/** Reads a dotted key out of a message catalogue, as `getTranslations` would. */
const translator =
  (catalogue: Record<string, unknown>) =>
  (key: string): string => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        catalogue.assistant,
      )
    if (typeof value !== 'string') throw new Error(`missing message: assistant.${key}`)
    return value
  }

const locales = [
  ['en', en],
  ['ar', ar],
] as const

describe.each(locales)('%s', (_locale, catalogue) => {
  const labels = assistantLabels(translator(catalogue))

  it('carries no functions across the server boundary', () => {
    const offenders = Object.entries(labels)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key)

    expect(offenders).toEqual([])
  })

  /*
    Deep, because the failure was one level down: `tools` is a record and a
    function hidden inside it would serialise no better than one at the top.
  */
  it('survives being serialised, which is what the boundary does to it', () => {
    expect(() => JSON.parse(JSON.stringify(labels))).not.toThrow()
    expect(JSON.parse(JSON.stringify(labels))).toEqual(labels)
  })

  it('has a label for every tool the assistant can call', () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(labels.tools[tool.name], `no label for ${tool.name}`).toBeTruthy()
    }
  })

  /*
    `next-intl` parses braces as ICU placeholders and throws when the argument
    is not supplied — and it cannot be supplied for this one, because the value
    is only known once a tool starts running on the client. `%label%` passes
    through untouched.
  */
  it('uses a placeholder next-intl will not try to resolve', () => {
    expect(labels.checking).toContain('%label%')
    expect(labels.checking).not.toMatch(/\{[^}]+\}/)
  })

  it('substitutes that placeholder into a real sentence', () => {
    const line = labels.checking.replace('%label%', labels.tools.list_overdue_invoices!)
    expect(line).not.toContain('%label%')
    expect(line.length).toBeGreaterThan(labels.checking.length - '%label%'.length)
  })

  it('offers four questions to start from, all of them written', () => {
    expect(labels.suggestions).toHaveLength(4)
    expect(labels.suggestions.every((suggestion) => suggestion.trim().length > 0)).toBe(true)
  })
})

describe('a tool with no label', () => {
  /*
    Falls back to the generic phrase rather than to the raw name. A tool added
    to the manifest without its message must read as "the records", never as
    `get_supplier_variance` — which is our schema on somebody's screen, in a
    language they do not use.
  */
  it('is left out, so the interface falls back rather than leaking a name', () => {
    const partial = translator({
      assistant: {
        ...(en.assistant as Record<string, unknown>),
        tools: { search: 'the registers' },
      },
    })

    const labels = assistantLabels(partial)
    expect(labels.tools.search).toBe('the registers')
    expect(labels.tools.list_overdue_invoices).toBeUndefined()
    expect(labels.toolUnknown).toBeTruthy()
  })
})

/*
  The words the assistant's tool results carry beside a code (`statusLabel`)
  are copied into `core/labels.ts`, because core imports nothing. This is what
  keeps the copy honest: every word must be the catalogue's, in both
  languages, and every code the catalogue names must be there.
*/
describe('the labels beside codes in tool results', () => {
  const at = (catalogue: Record<string, unknown>, path: string) =>
    path
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)[part],
        catalogue,
      ) as Record<string, unknown>

  it('are the catalogue’s own words, in both languages', () => {
    for (const [vocabulary, path] of Object.entries(LABEL_SOURCES)) {
      const words = LABELS[vocabulary as keyof typeof LABEL_SOURCES]
      const enWords = at(en, path)
      const arWords = at(ar, path)
      for (const [code, value] of Object.entries(enWords)) {
        if (typeof value !== 'string') continue
        expect(words[code], `${vocabulary}.${code} missing from core/labels.ts`).toEqual({
          en: value,
          ar: arWords[code],
        })
      }
      expect(Object.keys(words).sort()).toEqual(
        Object.keys(enWords)
          .filter((code) => typeof enWords[code] === 'string')
          .sort(),
      )
    }
  })
})
