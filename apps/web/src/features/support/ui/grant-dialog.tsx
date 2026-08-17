import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { grantSupportAccess } from '../form-actions'
import { supportEngineers } from '../queries'

/**
 * Open a support session.
 *
 * The form is shaped by one idea: the customer is the one granting, so every
 * choice that widens access has to be made deliberately rather than fallen
 * into.
 *
 * - Duration is a **select of short options**, not a free number. A field that
 *   accepts any integer accepts 720, and the person typing it is not thinking
 *   about a month, they are thinking about not being asked again.
 * - Branches default to nothing selected, and the action reads that as *the
 *   branches you hold* rather than as every branch. A blank multi-select is
 *   what someone submits when they have not considered the question, and it
 *   must not be the widest grant available.
 * - Write access needs a typed confirmation. Everything else about the
 *   escalation is enforced in `0008`; this is the part that has to happen in a
 *   human's head, and a radio button does not achieve it.
 */
export async function SupportGrantDialog() {
  const session = await requireSession()
  if (!can(session, 'admin.users.write')) return null
  // A support session must never be the thing handing out support access. The
  // action refuses it too; this stops the button rendering at all.
  if (session.actor.type === 'support') return null

  const [engineers, options, t, tc] = await Promise.all([
    supportEngineers(session.actor),
    loadOptions(session.actor),
    getTranslations('supportGrant'),
    getTranslations('common'),
  ])

  /*
    No engineers, no dialog.

    A vendor with no support principals provisioned in this deployment has no
    support contract running against it, and an empty picker is a worse answer
    than no button.
  */
  if (engineers.length === 0) return null

  const grantable = options.branches.filter((branch) => session.branchRoles.has(branch.value))

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'principalId',
      label: t('engineer'),
      span: 12,
      required: true,
      placeholder: t('engineerPlaceholder'),
      options: engineers.map((engineer) => ({
        value: engineer.id,
        label: `${engineer.nameEn} — ${engineer.email}`,
      })),
    },
    {
      kind: 'text',
      name: 'reason',
      label: t('reason'),
      span: 12,
      required: true,
      placeholder: t('reasonPlaceholder'),
      hint: t('reasonHint'),
      maxLength: 300,
    },
    {
      kind: 'select',
      name: 'hours',
      label: t('duration'),
      span: 6,
      required: true,
      defaultValue: '2',
      // Capped at the working day the action enforces. Anything longer is a
      // second grant and a second decision.
      options: [
        { value: '1', label: t('hours', { count: 1 }) },
        { value: '2', label: t('hours', { count: 2 }) },
        { value: '4', label: t('hours', { count: 4 }) },
        { value: '8', label: t('hours', { count: 8 }) },
      ],
    },
    {
      kind: 'select',
      name: 'scope',
      label: t('scope'),
      span: 6,
      defaultValue: 'read',
      options: [
        { value: 'read', label: t('scopeRead') },
        { value: 'write', label: t('scopeWrite') },
      ],
    },
    {
      kind: 'choices',
      name: 'branchIds',
      label: t('branches'),
      span: 12,
      hint: t('branchesHint'),
      options: grantable.map((branch) => ({ value: branch.value, label: branch.label })),
    },
    {
      kind: 'text',
      name: 'escalate',
      label: t('escalate'),
      span: 12,
      placeholder: 'GRANT WRITE',
      hint: t('escalateHint'),
      mono: true,
    },
    {
      kind: 'note',
      text: t('note'),
    },
  ]

  return (
    <RecordDialog
      action={grantSupportAccess}
      fields={fields}
      icon="audit"
      variant="secondary"
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description'),
        submit: t('submit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
