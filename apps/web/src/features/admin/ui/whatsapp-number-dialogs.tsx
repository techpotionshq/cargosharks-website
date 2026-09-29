/**
 * Mapping a WhatsApp number to a branch — FR-EQ-02, FR-AD-03.
 *
 * The counterpart of `mailbox-dialogs.tsx`. Simpler, because there is no
 * credential to seal here: a WhatsApp number is answered through Kapso, and the
 * one secret that opens the account lives at Settings › Integrations, not on the
 * row. This form only records which branch a `phone_number_id` belongs to.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { saveWhatsappNumber, setWhatsappNumberActive } from '../whatsapp-numbers'

export interface WhatsappNumberDefaults {
  readonly id?: string
  readonly branchId?: string
  readonly phoneNumberId?: string
  readonly displayNumber?: string | null
  readonly label?: string | null
}

export async function WhatsappNumberDialog({
  defaults,
  branches,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly defaults?: WhatsappNumberDefaults
  readonly branches: readonly { value: string; label: string }[]
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.mailboxes.write')) return null

  const [t, tc] = await Promise.all([
    getTranslations('whatsappNumbers'),
    getTranslations('common'),
  ])
  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    ...(editing ? [{ kind: 'hidden' as const, name: 'numberId', value: defaults!.id! }] : []),
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 12,
      required: true,
      hint: t('branchHint'),
      options: branches,
      placeholder: tc('choose'),
      defaultValue: defaults?.branchId,
    },
    {
      kind: 'text',
      name: 'phoneNumberId',
      label: t('phoneNumberId'),
      span: 12,
      required: true,
      hint: t('phoneNumberIdHint'),
      mono: true,
      placeholder: '1181979928328532',
      defaultValue: defaults?.phoneNumberId,
    },
    {
      kind: 'text',
      name: 'displayNumber',
      label: t('displayNumber'),
      span: 6,
      hint: t('displayNumberHint'),
      mono: true,
      placeholder: '+965 2200 0000',
      defaultValue: defaults?.displayNumber ?? '',
    },
    {
      kind: 'text',
      name: 'label',
      label: t('label'),
      span: 6,
      hint: t('labelHint'),
      defaultValue: defaults?.label ?? '',
    },
  ]

  return (
    <RecordDialog
      action={saveWhatsappNumber}
      fields={fields}
      icon="enquiries"
      size="lg"
      variant={variant}
      iconOnly={iconOnly}
      labels={{
        open: editing ? tc('edit') : t('connect'),
        title: editing ? t('editTitle') : t('connectTitle'),
        description: editing ? t('editSubtitle') : t('connectSubtitle'),
        submit: editing ? tc('save') : t('connect'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Stop answering on a number, or start again — deactivation, not deletion (§5.5).
 */
export async function ToggleWhatsappNumberButton({
  numberId,
  isActive,
}: {
  readonly numberId: string
  readonly isActive: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.mailboxes.write')) return null

  const [t, tc] = await Promise.all([
    getTranslations('whatsappNumbers'),
    getTranslations('common'),
  ])

  return (
    <RecordDialog
      action={setWhatsappNumberActive}
      icon={isActive ? 'hold' : 'live'}
      size="sm"
      variant="ghost"
      iconOnly
      fields={[
        { kind: 'hidden', name: 'numberId', value: numberId },
        { kind: 'hidden', name: 'isActive', value: isActive ? 'false' : 'true' },
        {
          kind: 'note',
          text: isActive ? t('deactivateWarning') : t('reactivateWarning'),
          tone: isActive ? 'caution' : 'info',
        },
      ]}
      labels={{
        open: isActive ? t('deactivate') : t('reactivate'),
        title: isActive ? t('deactivateTitle') : t('reactivateTitle'),
        description: isActive ? t('deactivateSubtitle') : t('reactivateSubtitle'),
        submit: isActive ? t('deactivate') : t('reactivate'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
