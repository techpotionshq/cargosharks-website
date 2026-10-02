/**
 * What you can do to an enquiry.
 *
 * Four actions, and they are the enquiry's whole lifecycle: hand it to
 * someone, record that a reply went out, price it, and close it won or lost.
 *
 * The order they appear in is the order they happen in, and each is gated on
 * its own permission — a coordinator can assign and reply, a salesperson can
 * quote, and closing is separate again because "we lost this and here is why"
 * is the single most valuable field in the slice and the one most likely to be
 * skipped if anyone can clear it in passing.
 *
 * All four are dialogs rather than bare buttons. Marking a reply as sent stops
 * an SLA clock, and closing an enquiry as lost is not undoable through the
 * interface — neither should happen on a stray click.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { assertTransition, canTransition, enquiryMachine, type EnquiryStatus } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog } from '@/ui/record-dialog'
import {
  advanceEnquiry,
  assignEnquiryAction,
  closeEnquiryAction,
  respondEnquiryAction,
} from '../form-actions'

export async function EnquiryActions({
  enquiryId,
  hasResponded,
  isClosed,
  status,
}: {
  readonly enquiryId: string
  /** Hides "mark replied" once the clock has already been stopped. */
  readonly hasResponded: boolean
  readonly isClosed: boolean
  /** Decides whether "start rating" is a move this enquiry can make. */
  readonly status?: string
}) {
  const session = await requireSession()

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('enquiryActions'),
    getTranslations('common'),
  ])

  const mayAssign = can(session, 'enquiry.assign')
  const mayClose = can(session, 'enquiry.close')
  /*
    Back to rating is two different moves with two different keys: pricing an
    assigned enquiry (`enquiry.rate`) and reopening a quoted one for revision
    (`quote.revise`). The transition knows which; the button asks it.
  */
  const rateFrom = status as EnquiryStatus | undefined
  const rateMove =
    rateFrom && canTransition(enquiryMachine, rateFrom, 'rating')
      ? assertTransition(enquiryMachine, rateFrom, 'rating')
      : undefined
  const mayRate = Boolean(rateMove && (!rateMove.requires || can(session, rateMove.requires)))
  const mayCancel = can(session, 'enquiry.cancel')

  // A closed enquiry is a record, not a queue item. Offering actions on it
  // would be offering to reopen something the state machine will refuse.
  if (isClosed) return null

  /*
    Only the outcomes the machine allows from here (S1). Won is legal only
    from `quoted` and lost not from `new`; both were offered in every open
    state, and choosing one the machine refused crashed the action. With no
    status known (an older caller), both stay offered and the action refuses.
  */
  const closeOutcomes = [
    ...(!status || canTransition(enquiryMachine, status as EnquiryStatus, 'won')
      ? [{ value: 'won', label: t('won'), icon: 'check' as const, hint: t('wonHint') }]
      : []),
    ...(!status || canTransition(enquiryMachine, status as EnquiryStatus, 'lost')
      ? [{ value: 'lost', label: t('lost'), icon: 'close' as const, hint: t('lostHint') }]
      : []),
  ]

  return (
    <>
      {mayAssign && !hasResponded ? (
        <RecordDialog
          action={respondEnquiryAction}
          icon="check"
          size="sm"
          variant="secondary"
          submitIcon="check"
          fields={[
            { kind: 'hidden', name: 'enquiryId', value: enquiryId },
            { kind: 'note', text: t('respondNote') },
          ]}
          labels={{
            open: t('respond'),
            title: t('respondTitle'),
            description: t('respondDescription'),
            submit: t('respondSubmit'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
            success: t('respondDone'),
          }}
        />
      ) : null}

      {mayAssign ? (
        <RecordDialog
          action={assignEnquiryAction}
          icon="user"
          size="sm"
          variant="secondary"
          fields={[
            { kind: 'hidden', name: 'enquiryId', value: enquiryId },
            {
              kind: 'select',
              name: 'ownerId',
              label: t('owner'),
              span: 12,
              required: true,
              hint: t('ownerHint'),
              options: options.people,
              placeholder: tc('choose'),
            },
          ]}
          labels={{
            open: t('assign'),
            title: t('assignTitle'),
            description: t('assignDescription'),
            submit: t('assignSubmit'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
            success: t('assignDone'),
          }}
        />
      ) : null}

      {/*
        Two transitions the machine declared and nothing offered.

        `rating` is what tells the escalation worker somebody is on it — an
        enquiry sitting in `assigned` looks unanswered whether it is being
        priced or has been forgotten. `cancelled` is for the customer who went
        elsewhere before we quoted, which is neither won nor lost and was
        previously chased for ever.
      */}
      {mayRate ? (
        <RecordDialog
          action={advanceEnquiry}
          icon="rates"
          size="sm"
          variant="ghost"
          fields={[
            { kind: 'hidden', name: 'enquiryId', value: enquiryId },
            { kind: 'hidden', name: 'to', value: 'rating' },
            { kind: 'note', text: t('ratingNote') },
          ]}
          labels={
            status === 'quoted'
              ? {
                  open: t('reopenRating'),
                  title: t('reopenRatingTitle'),
                  description: t('reopenRatingDescription'),
                  submit: t('reopenRating'),
                  submitting: tc('saving'),
                  cancel: tc('cancel'),
                }
              : {
                  open: t('startRating'),
                  title: t('startRatingTitle'),
                  description: t('startRatingDescription'),
                  submit: t('startRating'),
                  submitting: tc('saving'),
                  cancel: tc('cancel'),
                }
          }
        />
      ) : null}

      {mayCancel ? (
        <RecordDialog
          action={advanceEnquiry}
          icon="close"
          size="sm"
          // Ends the enquiry: drawn as the menu's destructive row, and its
          // confirm button is the filled red.
          variant="danger"
          fields={[
            { kind: 'hidden', name: 'enquiryId', value: enquiryId },
            { kind: 'hidden', name: 'to', value: 'cancelled' },
            {
              kind: 'textarea',
              name: 'reason',
              label: t('reason'),
              span: 12,
              required: true,
              rows: 3,
              hint: t('cancelReasonHint'),
            },
          ]}
          labels={{
            open: t('cancel'),
            title: t('cancelTitle'),
            description: t('cancelDescription'),
            submit: t('cancel'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
          }}
        />
      ) : null}

      {mayClose && closeOutcomes.length > 0 ? (
        <RecordDialog
          action={closeEnquiryAction}
          icon="sealed"
          size="sm"
          variant="secondary"
          fields={[
            { kind: 'hidden', name: 'enquiryId', value: enquiryId },
            {
              kind: 'choices',
              name: 'outcome',
              label: t('outcome'),
              span: 12,
              required: true,
              options: closeOutcomes,
            },
            {
              kind: 'textarea',
              name: 'reason',
              label: t('reason'),
              span: 12,
              rows: 3,
              /*
                Required only on a loss, and enforced by the action rather than
                by the field — a required attribute here would block closing a
                *won* enquiry until somebody typed something meaningless.
              */
              hint: t('reasonHint'),
              placeholder: t('reasonPlaceholder'),
            },
          ]}
          labels={{
            open: t('close'),
            title: t('closeTitle'),
            description: t('closeDescription'),
            submit: t('closeSubmit'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
            success: t('closeDone'),
          }}
        />
      ) : null}
    </>
  )
}
