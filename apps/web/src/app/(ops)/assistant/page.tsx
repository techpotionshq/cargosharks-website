/**
 * The assistant, full width — for when the conversation is the task.
 *
 * The dock is for a question asked *while* doing something else. This is the
 * other half: reading back a long thread, working through a morning's
 * exceptions one at a time, or handing somebody a URL to what was asked.
 *
 * Both surfaces render the same `Conversation`, deliberately. Two message
 * lists that each grew their own idea of what a proposal looks like would
 * disagree about the one thing a coordinator has to recognise instantly.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { AssistantPage } from '@/features/assistant/ui/assistant-page'
import { assistantLabels } from '@/features/assistant/labels'
import { usePilotFixtures } from '@/lib/pilot/source'
import { assistantConfigured } from '@/features/assistant/queries'

/** The tab says which screen this is, as the sidebar does, in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('assistant') }
}

export default async function Page() {
  /*
    Guarded here as well as by the layout, because a page is reachable by URL.
    The layout's redirect is for people who arrive by clicking; this is for the
    ones who arrive by typing, or by a link somebody pasted into a chat.
  */
  await requireSession()
  const t = await getTranslations('assistant')

  /*
    The page stays reachable without a key, unlike the dock and the nav entry.

    Somebody arriving here has typed the URL or followed a link, and the useful
    answer is what is missing and where to fix it — not a 404, which would read
    as the feature not existing on a deployment that has merely not bought it
    yet.
  */
  const configured = await assistantConfigured()

  /*
    The locale is passed down for the inbox's timestamps.

    A client component cannot reach `getLocale`, and `toLocaleString` with no
    locale takes the *browser's* — which is how an Arabic session ends up with
    English weekdays beside its Arabic questions.
  */
  const locale = await getLocale()

  return (
    <AssistantPage
      labels={assistantLabels(t, usePilotFixtures())}
      configured={configured}
      locale={locale}
    />
  )
}
