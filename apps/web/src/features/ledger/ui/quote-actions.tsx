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

export async function QuoteStatusActions({
  quoteId,
  status,
}: {
  readonly quoteId: string
  readonly status: string
}) {
  const session = await requireSession()
  const [t, tc, tq] = await Promise.all([
    getTranslations('quoteDetail'),
    getTranslations('common'),
    getTranslations('quotes'),
  ])

  const allowed = nextStates(quoteMachine, status as QuoteStatus)
    .map((next) => ({ next, move: MOVES[next] }))
    .filter(
      (entry): entry is { next: QuoteStatus; move: NonNullable<(typeof MOVES)[QuoteStatus]> } =>
        Boolean(entry.move) && can(session, entry.move!.permission),
    )

  if (allowed.length === 0) return null

  return (
    <>
      {allowed.map(({ next, move }) => (
        <RecordDialog
          key={next}
          action={setQuoteStatus}
          icon={move.icon}
          size="sm"
          variant={move.variant}
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
            open: tq(`statuses.${next}` as 'statuses.sent'),
            title: t(`moveTitle.${next}` as 'moveTitle.sent'),
            description: t(`moveDescription.${next}` as 'moveDescription.sent'),
            submit: t(`moveSubmit.${next}` as 'moveSubmit.sent'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
          }}
        />
      ))}
    </>
  )
}
