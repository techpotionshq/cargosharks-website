/**
 * Retiring a customer, and bringing one back — FR-ID-09, §5.5.
 *
 * The control for the rule `actions.ts` has always described and never
 * offered: a customer with shipment history cannot be removed without taking
 * the history with it, so the record stays and stops being selectable.
 *
 * A dialog rather than a toggle in the header. The two directions are not
 * symmetrical — restoring puts a name back in the pickers, retiring takes it
 * out of every one of them — and the destructive direction should cost a
 * deliberate second click.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { setCustomerActive } from '../actions'

export async function RetireCustomerDialog({
  customerId,
  name,
  isActive,
}: {
  readonly customerId: string
  readonly name: string
  /** Current state. The dialog offers the opposite of it. */
  readonly isActive: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'customer.write')) return null

  const [t, tc] = await Promise.all([getTranslations('customers'), getTranslations('common')])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'customerId', value: customerId },
    // Presence is the signal — see `setCustomerActive`.
    ...(isActive ? [] : [{ kind: 'hidden' as const, name: 'isActive', value: 'true' }]),
    {
      kind: 'note',
      text: isActive ? t('retireWarning') : t('restoreNote'),
      tone: isActive ? 'caution' : 'info',
    },
  ]

  return (
    <RecordDialog
      action={setCustomerActive}
      fields={fields}
      icon={isActive ? 'hold' : 'check'}
      /*
        Outlined, not ghost — and critical only in the direction that removes
        something.

        A ghost trigger reads as a label rather than a control, which is the
        wrong affordance for the only destructive act on the screen: retiring a
        customer takes them out of every enquiry and job picker in the product.
        `danger` here is the outlined variant, not the filled one, so it is
        legible without competing with the form's own submit. Restoring is the
        harmless direction and stays `secondary`.
      */
      variant={isActive ? 'danger' : 'secondary'}
      submitIcon={isActive ? 'hold' : 'check'}
      labels={{
        open: isActive ? t('retire') : t('restore'),
        title: isActive ? t('retireTitle', { name }) : t('restoreTitle', { name }),
        description: isActive ? t('retireDescription') : t('restoreDescription'),
        submit: isActive ? t('retire') : t('restore'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
