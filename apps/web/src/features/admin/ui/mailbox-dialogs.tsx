/**
 * Connecting a mailbox — FR-EQ-02, FR-AD-03.
 *
 * The password field is blank on an edit, always, and the hint says why: the
 * stored credential is sealed and this screen has no way to read it back.
 * Leaving it blank keeps the existing one. That is the opposite of the usual
 * form convention, so it is stated on the field rather than assumed.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { saveMailbox, setMailboxActive } from '../mailboxes'

export interface MailboxDefaults {
  readonly id?: string
  readonly branchId?: string
  readonly host?: string
  readonly port?: number
  readonly secure?: boolean
  readonly username?: string
  readonly folder?: string
  readonly archiveFolder?: string | null
}

export async function MailboxDialog({
  defaults,
  branches,
  keyConfigured,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly defaults?: MailboxDefaults
  readonly branches: readonly { value: string; label: string }[]
  readonly keyConfigured: boolean
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.mailboxes.write')) return null

  const [t, tc] = await Promise.all([getTranslations('mailboxes'), getTranslations('common')])
  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    ...(editing ? [{ kind: 'hidden' as const, name: 'mailboxId', value: defaults!.id! }] : []),

    /*
      Said before the form rather than after the failure.

      Without the key nothing here can be saved, and an administrator who
      fills in six fields and is then told the deployment cannot accept them
      has been wasted rather than informed.
    */
    ...(keyConfigured
      ? []
      : [{ kind: 'note' as const, text: t('noKey'), tone: 'caution' as const }]),

    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      hint: t('branchHint'),
      options: branches,
      placeholder: tc('choose'),
      defaultValue: defaults?.branchId,
    },
    {
      kind: 'email',
      name: 'username',
      label: t('username'),
      span: 6,
      required: true,
      hint: t('usernameHint'),
      mono: true,
      defaultValue: defaults?.username,
    },
    {
      kind: 'text',
      name: 'host',
      label: t('host'),
      span: 6,
      required: true,
      hint: t('hostHint'),
      mono: true,
      placeholder: 'outlook.office365.com',
      defaultValue: defaults?.host,
    },
    {
      kind: 'number',
      name: 'port',
      label: t('port'),
      span: 3,
      required: true,
      min: 1,
      max: 65535,
      defaultValue: defaults?.port ?? 993,
    },
    {
      kind: 'switch',
      name: 'secure',
      label: t('secure'),
      span: 3,
      hint: t('secureHint'),
      defaultChecked: defaults?.secure ?? true,
    },
    {
      kind: 'password',
      name: 'password',
      label: t('password'),
      span: 12,
      required: !editing,
      // The one field whose behaviour is not what a form usually does.
      hint: editing ? t('passwordKeepHint') : t('passwordHint'),
    },
    {
      kind: 'text',
      name: 'folder',
      label: t('folder'),
      span: 6,
      required: true,
      hint: t('folderHint'),
      mono: true,
      defaultValue: defaults?.folder ?? 'INBOX',
    },
    {
      kind: 'text',
      name: 'archiveFolder',
      label: t('archiveFolder'),
      span: 6,
      hint: t('archiveFolderHint'),
      mono: true,
      defaultValue: defaults?.archiveFolder ?? '',
    },
  ]

  return (
    <RecordDialog
      action={saveMailbox}
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
 * Stop reading a mailbox, or start again.
 *
 * Deactivation rather than deletion (§5.5): the row remains the record of what
 * was being read, under whose address, and until when.
 */
export async function ToggleMailboxButton({
  mailboxId,
  isActive,
}: {
  readonly mailboxId: string
  readonly isActive: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.mailboxes.write')) return null

  const [t, tc] = await Promise.all([getTranslations('mailboxes'), getTranslations('common')])

  return (
    <RecordDialog
      action={setMailboxActive}
      icon={isActive ? 'hold' : 'live'}
      size="sm"
      variant="ghost"
      iconOnly
      fields={[
        { kind: 'hidden', name: 'mailboxId', value: mailboxId },
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
