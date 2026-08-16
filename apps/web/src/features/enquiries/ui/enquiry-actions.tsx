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

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog } from '@/ui/record-dialog'
import { assignEnquiryAction, closeEnquiryAction, respondEnquiryAction } from '../form-actions'

export async function EnquiryActions({
  enquiryId,
  hasResponded,
  isClosed,
}: {
  readonly enquiryId: string
  /** Hides "mark replied" once the clock has already been stopped. */
  readonly hasResponded: boolean
  readonly isClosed: boolean
}) {
  const session = await requireSession()

  const [options, t, tc] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('enquiryActions'),
    getTranslations('common'),
  ])

  const mayAssign = can(session, 'enquiry.assign')
  const mayClose = can(session, 'enquiry.close')

  // A closed enquiry is a record, not a queue item. Offering actions on it
  // would be offering to reopen something the state machine will refuse.
  if (isClosed) return null

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
              placeholder: tc('none'),
            },
          ]}
          labels={{
            open: t('assign'),
            title: t('assignTitle'),
            description: t('assignDescription'),
            submit: t('assignSubmit'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
          }}
        />
      ) : null}

      {mayClose ? (
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
              options: [
                { value: 'won', label: t('won'), icon: 'check', hint: t('wonHint') },
                { value: 'lost', label: t('lost'), icon: 'close', hint: t('lostHint') },
              ],
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
          }}
        />
      ) : null}
    </>
  )
}
