'use client'

/**
 * The covering note, drafted by the model and owned by a coordinator.
 *
 * Two moves per language, and the split is deliberate. **Draft** asks the
 * service to write prose — it persists the note and the page revalidates, so a
 * successful draft arrives back as a new `note` prop and the textarea, keyed on
 * it, remounts showing the drafted words. **Save** is a plain textarea a person
 * edits and stores, because the drafted prose is a starting point and not a
 * decision. The model writes sentences; every figure stays owned by the pricing
 * already frozen on the quote, which is why nothing here touches a total.
 *
 * Both are offered only on a draft quotation — the server actions refuse
 * anything else, and the panel is not rendered once a quote is sent.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { draftQuoteCoverNote, setQuoteCoverNote } from '../form-actions'
import { FOCUS_RING } from '@/ui/control'

export interface CoverNoteLabels {
  readonly english: string
  readonly arabic: string
  readonly placeholder: string
  readonly draft: string
  readonly drafting: string
  readonly save: string
  readonly saving: string
  readonly saved: string
}

export function CoverNoteEditor({
  quoteId,
  notes,
  labels,
}: {
  readonly quoteId: string
  readonly notes: { readonly en: string | null; readonly ar: string | null }
  readonly labels: CoverNoteLabels
}) {
  return (
    <div className="flex flex-col gap-5">
      <LocaleNote
        quoteId={quoteId}
        locale="en"
        heading={labels.english}
        note={notes.en}
        labels={labels}
      />
      <LocaleNote
        quoteId={quoteId}
        locale="ar"
        heading={labels.arabic}
        note={notes.ar}
        labels={labels}
      />
    </div>
  )
}

function LocaleNote({
  quoteId,
  locale,
  heading,
  note,
  labels,
}: {
  readonly quoteId: string
  readonly locale: 'en' | 'ar'
  readonly heading: string
  readonly note: string | null
  readonly labels: CoverNoteLabels
}) {
  const [draftState, draftAction, drafting] = useActionState<ActionState, FormData>(
    draftQuoteCoverNote,
    {},
  )
  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(
    setQuoteCoverNote,
    {},
  )

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-medium text-ink">{heading}</span>
        {/*
          A form of its own, not a button inside the save form — the two submit
          different actions, and a covering note is drafted or saved, never both
          at once.
        */}
        <form action={draftAction}>
          <input type="hidden" name="quoteId" value={quoteId} />
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" size="sm" variant="ghost" icon="assistant" disabled={drafting}>
            {drafting ? labels.drafting : labels.draft}
          </Button>
        </form>
      </div>

      <form action={saveAction}>
        <input type="hidden" name="quoteId" value={quoteId} />
        <input type="hidden" name="locale" value={locale} />
        {/*
          Keyed on the note so a fresh draft — which revalidates the page and
          arrives as a new prop — remounts the textarea with the drafted prose
          rather than leaving the old value behind an uncontrolled input.
        */}
        <textarea
          key={note ?? ''}
          name="note"
          defaultValue={note ?? ''}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          rows={4}
          placeholder={labels.placeholder}
          className={`w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-[0.875rem] leading-relaxed text-ink placeholder:text-ink-subtle ${FOCUS_RING}`}
        />
        {draftState.message ? (
          <p className="mt-1 text-[0.8125rem] text-caution">{draftState.message}</p>
        ) : null}
        {saveState.message ? (
          <p className="mt-1 text-[0.8125rem] text-caution">{saveState.message}</p>
        ) : null}
        <div className="mt-2 flex items-center justify-end gap-3">
          {saveState.ok ? (
            <span className="text-[0.75rem] text-positive">{labels.saved}</span>
          ) : null}
          <Button type="submit" size="sm" variant="secondary" icon="check" disabled={saving}>
            {saving ? labels.saving : labels.save}
          </Button>
        </div>
      </form>
    </section>
  )
}
