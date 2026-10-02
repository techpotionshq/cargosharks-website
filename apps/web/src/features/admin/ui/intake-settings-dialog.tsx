/**
 * One branch's intake-agent settings — the timing, the patience, and what a
 * complete enquiry must state.
 *
 * Generated from the same bounds the action validates and the worker clamps
 * (`INTAKE_SETTING_BOUNDS` in core), so the form cannot offer a value the
 * agent would then quietly correct. The required details are switches grouped
 * by mode, because "for air, weight or volume" is how a forwarder thinks about
 * it, and a free-text list would be a second vocabulary for the agent to fail
 * to phrase.
 */

import { getTranslations } from 'next-intl/server'
import { INTAKE_SETTING_BOUNDS, requirementChoiceFor } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { canIn } from '@/lib/permissions'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import type { IntakeSettingsRowLike } from '@/lib/pilot/types'
import { intakeFieldChoices, saveIntakeSettings } from '../intake-settings'

const NUMBER_FIELDS = Object.keys(INTAKE_SETTING_BOUNDS) as (keyof typeof INTAKE_SETTING_BOUNDS)[]

export async function IntakeSettingsDialog({ row }: { readonly row: IntakeSettingsRowLike }) {
  const session = await requireSession()
  if (!canIn(session, 'admin.mailboxes.write', row.branchId)) return null

  const [t, tc, tMode, tAgent, choices] = await Promise.all([
    getTranslations('intakeSettings'),
    getTranslations('common'),
    getTranslations('mode'),
    getTranslations('intakeAgent'),
    intakeFieldChoices(),
  ])

  // Matched to the menu by fields as well as key (`requirementChoiceFor`), so a
  // row stored under an older key still shows ticked and survives the save.
  const required = new Set(
    row.requirements.flatMap((r) => {
      const choice = requirementChoiceFor(r)
      return choice ? [`${r.mode ?? 'all'}.${choice}`] : []
    }),
  )

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'branchId', value: row.branchId },
    {
      kind: 'switch',
      name: 'enabled',
      label: t('enabled'),
      hint: t('enabledHint'),
      span: 12,
      defaultChecked: row.enabled,
    },
    {
      kind: 'section',
      title: t('timing'),
      hint: t('timingHint'),
      fields: NUMBER_FIELDS.map((name) => ({
        kind: 'number' as const,
        name,
        label: t(`fields.${name}` as 'fields.clarifyCap'),
        span: 6 as const,
        required: true,
        min: INTAKE_SETTING_BOUNDS[name].min,
        max: INTAKE_SETTING_BOUNDS[name].max,
        step: '1',
        defaultValue: row[name],
      })),
    },
    ...Object.entries(choices).map(([scope, keys]) => ({
      kind: 'section' as const,
      title:
        scope === 'all' ? t('requiredAll') : t('requiredFor', { mode: tMode(scope as 'sea_fcl') }),
      fields: keys.map((key) => ({
        kind: 'switch' as const,
        name: `req.${scope}.${key}`,
        label: tAgent(`requirements.${key}` as 'requirements.mode'),
        span: 6 as const,
        defaultChecked: required.has(`${scope}.${key}`),
      })),
    })),
  ]

  return (
    <RecordDialog
      action={saveIntakeSettings}
      fields={fields}
      icon="assistant"
      size="lg"
      variant="secondary"
      labels={{
        open: tc('edit'),
        title: t('editTitle', { branch: row.branchCode }),
        description: row.inherited ? t('inheritedHint') : t('editSubtitle'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
