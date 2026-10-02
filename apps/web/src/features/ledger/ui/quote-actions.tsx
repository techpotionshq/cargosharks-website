/**
 * The moves a quotation can make, offered only where the machine allows them.
 *
 * `nextStates` comes from `@qabandi/core`, so this list is generated from the
 * same state machine the server action asserts against. That is the point: an
 * interface that offers a move the domain will refuse teaches people that the
 * software is unreliable, and one that hides a legal move makes them phone
 * somebody. Reading both from one definition is the only way they stay in step.
 *
 * The permission is checked per action as well — sending, accepting and
 * rejecting are three different rights, because the person who prices a job is
 * usually not the person allowed to accept on the customer's behalf.
 */

import { getTranslations } from 'next-intl/server'
import { nextStates, quoteMachine, type QuoteStatus } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { RecordDialog } from '@/ui/record-dialog'
import { setQuoteStatus } from '../form-actions'

/** Which right each move needs, and what the button should look like. */
const MOVES: Partial<
  Record<
    QuoteStatus,
    {
      permission: string
      variant: 'primary' | 'secondary' | 'danger'
      icon: 'arrow-end' | 'check' | 'close'
    }
  >
> = {
  sent: { permission: 'quote.send', variant: 'primary', icon: 'arrow-end' },
  accepted: { permission: 'quote.accept', variant: 'primary', icon: 'check' },
  /*
    Rejecting is a normal outcome, not a destructive act — the customer went
    elsewhere. It used to wear the danger treatment, which put two reds side
    by side and made "they said no" look like "delete this".
  */
  rejected: { permission: 'quote.reject', variant: 'secondary', icon: 'close' },
}

/** The moves that take the record forward, as opposed to ending it. */
const FORWARD: readonly QuoteStatus[] = ['sent', 'accepted']

export async function QuoteStatusActions({
  quoteId,
  status,
  part = 'all',
}: {
  readonly quoteId: string
  readonly status: string
  /**
   * Which half of the moves to render.
   *
   * A detail page header shows the move that takes the record *forward* as
   * its one primary button and folds the rest — voiding, crediting,
   * rejecting — into its More menu, so the page is split by the caller and
   * each half asks for its own. `all` is the old behaviour.
   */
  readonly part?: 'forward' | 'other' | 'all'
}) {
  const session = await requireSession()
  const [t, tc] = await Promise.all([getTranslations('quoteDetail'), getTranslations('common')])

  const allowed = nextStates(quoteMachine, status as QuoteStatus)
    .map((next) => ({ next, move: MOVES[next] }))
    .filter(
      (entry): entry is { next: QuoteStatus; move: NonNullable<(typeof MOVES)[QuoteStatus]> } =>
        Boolean(entry.move) && can(session, entry.move!.permission),
    )

  // One forward move at most: the first the machine offers. Anything after
  // it is still offered, in the menu.
  const lead = allowed.find(({ next }) => FORWARD.includes(next))
  const shown =
    part === 'all'
      ? allowed
      : part === 'forward'
        ? lead
          ? [lead]
          : []
        : allowed.filter((entry) => entry !== lead)

  if (shown.length === 0) return null

  return (
    <>
      {shown.map(({ next, move }) => (
        <RecordDialog
          key={next}
          action={setQuoteStatus}
          icon={move.icon}
          size="sm"
          // The forward move is the header's one primary button.
          variant={part === 'forward' ? 'primary' : move.variant}
          submitIcon={move.icon}
          fields={[
            { kind: 'hidden', name: 'quoteId', value: quoteId },
            { kind: 'hidden', name: 'status', value: next },
            {
              kind: 'note',
              text: t(`confirm.${next}` as 'confirm.sent'),
              // Accepting a quotation commits a price to a customer, and
              // rejecting one closes the opportunity. Both warrant a pause.
              tone: next === 'rejected' ? 'caution' : 'info',
            },
          ]}
          labels={{
            // A verb, not the status — see the same line in `invoice-actions`.
            open: t(`moveOpen.${next}` as 'moveOpen.sent'),
            title: t(`moveTitle.${next}` as 'moveTitle.sent'),
            description: t(`moveDescription.${next}` as 'moveDescription.sent'),
            submit: t(`moveSubmit.${next}` as 'moveSubmit.sent'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
            success: t(`moveDone.${next}` as 'moveDone.sent'),
          }}
        />
      ))}
    </>
  )
}
