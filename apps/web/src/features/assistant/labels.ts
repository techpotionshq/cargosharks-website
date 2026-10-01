/**
 * The assistant's strings, resolved on the server.
 *
 * Three surfaces need the same set — the dock, the full page and the page's
 * header — and a client component cannot reach `getTranslations` without
 * dragging the whole message catalogue across the boundary. So the server
 * resolves them and passes an object.
 *
 * ## Everything here is data, and that is a hard rule
 *
 * An earlier version passed `tool(name)` and `checking(label)` as functions,
 * which is exactly what a server component may not do: props crossing into a
 * client component are serialised, and a function has no serialisation. It
 * failed at render with *"Functions cannot be passed directly to Client
 * Components"* — a whole-screen error, not a degraded label.
 *
 * So the lookup is a record and the template is a string with a `%label%`
 * placeholder — braces would be read by `next-intl` as ICU and throw on the
 * argument that cannot be supplied here. The client does the substitution, which is where the value it
 * substitutes is known anyway.
 *
 * A function rather than three copies of the same literal, because the day one
 * surface gains a label is the day the other two render `undefined`.
 */

import { ASSISTANT_TOOLS } from '@qabandi/core'
import type { DockLabels } from './ui/assistant-dock'
import { ASSISTANT_FAILURES, type AssistantFailure } from './failures'

type Translator = (key: string) => string

/**
 * One sentence per tool, keyed by the name the stream sends.
 *
 * Built from `ASSISTANT_TOOLS` rather than written out again, so a tool added
 * to the manifest is a tool that appears here — and one whose label is missing
 * shows the generic line instead of leaking `get_supplier_variance` onto
 * somebody's screen in a language they do not use.
 */
function toolLabels(t: Translator): Record<string, string> {
  const labels: Record<string, string> = {}

  for (const tool of ASSISTANT_TOOLS) {
    const key = `tools.${tool.name}`
    let label: string
    try {
      label = t(key)
    } catch {
      // `next-intl` throws on a missing key in development and returns the key
      // in production. Both mean the same thing here.
      label = ''
    }
    if (label && label !== key && !label.endsWith(key)) labels[tool.name] = label
  }

  return labels
}

export function assistantLabels(t: Translator): DockLabels {
  return {
    title: t('title'),
    placeholder: t('placeholder'),
    ask: t('ask'),
    /** The keyboard contract under the composer: Enter sends, Shift+Enter breaks. */
    composerHint: t('composerHint'),
    thinking: t('thinking'),
    emptyTitle: t('emptyTitle'),
    emptyHint: t('emptyHint'),
    looked: t('looked'),
    tools: toolLabels(t),
    toolUnknown: t('toolUnknown'),
    /** Carries `%label%`; the client substitutes the tool's phrase. */
    checking: t('checking'),
    confirm: t('confirm'),
    proposalNote: t('proposalNote'),
    truncated: t('truncated'),
    emptyReply: t('emptyReply'),
    notConfigured: t('notConfigured'),
    notConfiguredHint: t('notConfiguredHint'),
    openSettings: t('openSettings'),
    unreachable: t('unreachable'),
    unreachableHint: t('unreachableHint'),
    serviceMissing: t('serviceMissing'),
    serviceMissingHint: t('serviceMissingHint'),
    // A record built from the codes, so a code added to `failures.ts` without
    // a sentence here is a type error rather than `undefined` on screen.
    failures: Object.fromEntries(
      ASSISTANT_FAILURES.map((code) => [code, t(`failures.${code}`)]),
    ) as Record<AssistantFailure, string>,
    newThread: t('newThread'),
    threads: t('threads'),
    noThreads: t('noThreads'),
    closeThread: t('closeThread'),
    expand: t('expand'),
    collapse: t('collapse'),
    minimise: t('minimise'),
    openFull: t('openFull'),
    loading: t('loading'),
    suggestions: [
      t('suggestions.overdue'),
      t('suggestions.clearance'),
      t('suggestions.freeTime'),
      t('suggestions.exceptions'),
    ],
  }
}
