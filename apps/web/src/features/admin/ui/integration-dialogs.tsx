/**
 * Configuring one integration — FR-AD-03.
 *
 * The form is generated from `INTEGRATIONS` in `@qabandi/core` rather than
 * written per integration, and that is not brevity for its own sake. There are
 * ten of these and they differ only in their fields; ten hand-written forms is
 * ten places for the catalogue and the screen to disagree, and the way that
 * disagreement shows up is a field an administrator fills in that nothing ever
 * reads.
 *
 * Two conventions here are the opposite of what a form usually does, and both
 * are stated on the field rather than assumed:
 *
 *   - **A blank credential means unchanged.** The stored value is sealed and
 *     this screen has no way to read it back, so it cannot be pre-filled.
 *     Clearing on blank would mean correcting a base URL silently destroys the
 *     key beside it.
 *   - **A value inherited from the environment is shown as the default.**
 *     Typing over it writes a row that then wins; leaving it alone writes
 *     nothing for that field and the variable keeps answering. The badge on
 *     each field says which of the two is happening, because "I changed it and
 *     nothing happened" is otherwise unanswerable from this screen.
 */

import { getTranslations } from 'next-intl/server'
import { integrationSpec, type IntegrationField } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import type { Span } from '@/ui/form'
import { saveIntegration, setIntegrationActive, type IntegrationView } from '../integrations'

/** The catalogue's field kinds, mapped onto the dialog's. */
function inputKind(field: IntegrationField): 'text' | 'url' | 'number' | 'email' {
  if (field.kind === 'switch') return 'text' // never reached; switches branch first
  return field.kind
}

export async function IntegrationDialog({
  integration,
  keyProblem,
  variant = 'secondary',
  iconOnly = false,
}: {
  readonly integration: IntegrationView
  /** Why a credential cannot be sealed, or null. Shown before the fields. */
  readonly keyProblem: string | null
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.integrations.write')) return null

  const spec = integrationSpec(integration.key)
  if (!spec) return null

  const [t, tc] = await Promise.all([getTranslations('integrations'), getTranslations('common')])

  const label = (path: string): string => t(path as 'keys.smtp')

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'key', value: integration.key },

    /*
      Said before the form rather than after the failure.

      Without the key no credential here can be sealed, and an administrator
      who fills in six fields and is only then told the deployment cannot
      accept them has been wasted rather than informed.
    */
    ...(!keyProblem || spec.secrets.length === 0
      ? []
      : [{ kind: 'note' as const, text: `${t('noKey')} ${keyProblem}`, tone: 'caution' as const }]),

    ...(spec.drivers
      ? [
          {
            kind: 'choices' as const,
            name: 'driver',
            label: t('driver'),
            span: 12 as Span,
            hint: t('driverHint'),
            defaultValue: integration.driver ?? spec.defaultDriver ?? null,
            options: spec.drivers.map((driver) => ({
              value: driver.value,
              label: label(`drivers.${integration.key}.${driver.value}`),
            })),
          },
        ]
      : []),

    ...spec.fields.map((field): FieldSpec => {
      const current = integration.fields.find((f) => f.name === field.name)

      /*
        The hint carries where the value came from.

        `env` means a variable is answering and this form is showing it as a
        default; type over it and a row takes precedence from the next resolve.
        Without this the screen looks like it is displaying stored settings,
        and a deployment mid-migration reads as configured when it is not.
      */
      const hint =
        current?.source === 'env'
          ? t('fromEnv', { variable: field.env })
          : current?.source === 'row'
            ? t('fromRow')
            : t('fromNothing', { variable: field.env })

      if (field.kind === 'switch') {
        return {
          kind: 'switch',
          name: field.name,
          label: label(`fields.${integration.key}.${field.name}`),
          span: 6,
          hint,
          /*
            The catalogue's safe position when neither layer has an answer.

            Not `false`. A switch posts nothing when it is off, so an unchecked
            box saved as part of an unrelated edit writes an explicit `false` —
            and for `rejectUnauthorized` that silently disables certificate
            verification on a deployment that never set the variable.
          */
          defaultChecked:
            current?.value === undefined ? (field.defaultOn ?? false) : current.value !== 'false',
        }
      }

      return {
        kind: inputKind(field),
        name: field.name,
        label: label(`fields.${integration.key}.${field.name}`),
        span: (field.kind === 'number' ? 4 : 12) as Span,
        required: false,
        hint,
        mono: field.mono,
        placeholder: field.placeholder,
        min: field.min,
        max: field.max,
        defaultValue: current?.value ?? '',
      }
    }),

    ...(spec.secrets.length > 0
      ? [
          {
            kind: 'section' as const,
            title: t('credentials'),
            hint: t('credentialsHint'),
            fields: spec.secrets.map((secret): FieldSpec => {
              const stored = integration.secrets.find((s) => s.name === secret.name)
              return {
                kind: 'password',
                name: secret.name,
                label: label(`secrets.${integration.key}.${secret.name}`),
                span: 12,
                // Never required at the input layer: "already stored" is a
                // valid way to satisfy a required credential, and only the
                // action can know whether that is the case.
                hint: stored?.isSet
                  ? t('secretKeepHint')
                  : t('secretHint', { variable: secret.env }),
              }
            }),
          },
        ]
      : []),
  ]

  return (
    <RecordDialog
      action={saveIntegration}
      fields={fields}
      icon="admin"
      size="lg"
      variant={variant}
      iconOnly={iconOnly}
      labels={{
        open: t('configure'),
        title: t('editTitle', { name: label(`keys.${integration.key}`) }),
        description: t('editSubtitle'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Stop using the row, or start again.
 *
 * Deactivating is a rollback rather than a deletion: the resolver skips an
 * inactive row and the environment answers instead, so what was typed survives
 * and the deployment goes back to exactly how it was configured before. Only
 * offered where a row exists — there is nothing to roll back to otherwise.
 */
export async function ToggleIntegrationButton({
  integrationKey,
  isActive,
}: {
  readonly integrationKey: string
  readonly isActive: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.integrations.write')) return null

  const [t, tc] = await Promise.all([getTranslations('integrations'), getTranslations('common')])

  return (
    <RecordDialog
      action={setIntegrationActive}
      icon={isActive ? 'hold' : 'live'}
      size="sm"
      variant="ghost"
      iconOnly
      fields={[
        { kind: 'hidden', name: 'key', value: integrationKey },
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
