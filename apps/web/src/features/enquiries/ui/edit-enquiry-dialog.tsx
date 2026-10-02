/**
 * "Edit details" — correcting an open enquiry's facts after it arrived (D4).
 *
 * The same fields as the new-enquiry dialog, in the same order (who is asking,
 * what is moving, from where to where, how big), so somebody who has raised an
 * enquiry already knows where everything is. Two are missing on purpose: the
 * branch, because an enquiry does not move between legal entities, and the
 * channel, because how it arrived is a fact rather than a setting. The
 * container type is added, since a mail-borne FCL enquiry often has a count
 * the model read and a box it did not.
 *
 * Built on `RecordDialog` like every other edit in the product, server-side,
 * so the options and the labels cross as plain JSON and the action stays the
 * only validator. Renders nothing on a closed enquiry or for a reader without
 * `enquiry.assign` in its branch; the action re-checks both.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { enquiryMachine, isTerminal, type EnquiryStatus } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { canIn } from '@/lib/permissions'
import { loadOptions, type Choice } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { enquiryForEdit } from '../queries'
import { updateEnquiry } from '../form-actions'

/*
  The current row, put back into a capped list that left it out. Without it
  the select opens on "none" and saving unchanged clears the field.
*/
function withCurrent(
  options: readonly Choice[],
  value: string | null,
  label: string | null,
): readonly Choice[] {
  if (!value || options.some((option) => option.value === value)) return options
  return [{ value, label: label ?? value }, ...options]
}

/** `2400.500000` as `2400.5` — the column's scale is not something a person typed. */
function asTyped(value: string | null): string | null {
  if (value === null || !value.includes('.')) return value
  return value.replace(/0+$/, '').replace(/\.$/, '')
}

export async function EditEnquiryDialog({ enquiryId }: { readonly enquiryId: string }) {
  const session = await requireSession()
  const resolved = await getLocale()
  const locale = resolved === 'ar' ? 'ar' : 'en'
  const enquiry = await enquiryForEdit(session.actor, enquiryId, locale)
  if (!enquiry) return null
  if (isTerminal(enquiryMachine, enquiry.status as EnquiryStatus)) return null
  if (!canIn(session, 'enquiry.assign', enquiry.branchId)) return null

  const [options, t, tMode, tDirection, tc] = await Promise.all([
    loadOptions(session.actor, locale),
    getTranslations('enquiryForm'),
    getTranslations('mode'),
    getTranslations('direction'),
    getTranslations('common'),
  ])

  const modes = [
    { value: 'sea_fcl', label: tMode('sea_fcl'), icon: 'container' as const },
    { value: 'sea_lcl', label: tMode('sea_lcl'), icon: 'ship' as const },
    { value: 'air', label: tMode('air'), icon: 'plane' as const },
    { value: 'land', label: tMode('land'), icon: 'truck' as const },
    // Offered only where the enquiry already is one: the new-enquiry dialog
    // does not offer it, and a radio group cannot keep a value it does not list.
    ...(enquiry.mode === 'courier'
      ? [{ value: 'courier', label: tMode('courier'), icon: 'courier' as const }]
      : []),
  ]

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'enquiryId', value: enquiry.id },
    {
      kind: 'section',
      title: t('who'),
      hint: t('whoEditHint'),
      fields: [
        {
          kind: 'select',
          name: 'customerId',
          label: t('customer'),
          span: 12,
          options: withCurrent(options.customers, enquiry.customerId, enquiry.customerLabel),
          defaultValue: enquiry.customerId,
          placeholder: t('none'),
          hint: t('customerHint'),
        },
        {
          kind: 'text',
          name: 'contactName',
          label: t('contactName'),
          span: 6,
          defaultValue: enquiry.contactName,
        },
        {
          kind: 'email',
          name: 'contactEmail',
          label: t('contactEmail'),
          span: 6,
          defaultValue: enquiry.contactEmail,
        },
      ],
    },
    {
      kind: 'section',
      title: t('what'),
      fields: [
        {
          kind: 'choices',
          name: 'mode',
          label: t('mode'),
          options: modes,
          defaultValue: enquiry.mode,
        },
        {
          kind: 'choices',
          name: 'tradeDirection',
          label: t('direction'),
          options: (['import', 'export', 'cross_trade'] as const).map((value) => ({
            value,
            label: tDirection(value),
          })),
          defaultValue: enquiry.tradeDirection,
        },
        {
          kind: 'select',
          name: 'commodityId',
          label: t('commodity'),
          span: 6,
          options: withCurrent(options.commodities, enquiry.commodityId, enquiry.commodityLabel),
          defaultValue: enquiry.commodityId,
          placeholder: t('none'),
        },
        {
          kind: 'select',
          name: 'incoterm',
          label: t('incoterm'),
          span: 6,
          options: withCurrent(options.incoterms, enquiry.incoterm, null),
          defaultValue: enquiry.incoterm,
          placeholder: t('none'),
          hint: t('incotermHint'),
        },
      ],
    },
    {
      kind: 'section',
      title: t('lane'),
      fields: [
        {
          kind: 'select',
          name: 'originId',
          label: t('origin'),
          span: 4,
          options: withCurrent(options.locations, enquiry.originId, enquiry.originLabel),
          defaultValue: enquiry.originId,
          placeholder: t('none'),
        },
        {
          kind: 'select',
          name: 'destinationId',
          label: t('destination'),
          span: 4,
          options: withCurrent(options.locations, enquiry.destinationId, enquiry.destinationLabel),
          defaultValue: enquiry.destinationId,
          placeholder: t('none'),
        },
        {
          kind: 'date',
          name: 'readyOn',
          label: t('readyOn'),
          span: 4,
          defaultValue: enquiry.readyOn,
          hint: t('readyOnHint'),
        },
      ],
    },
    {
      kind: 'section',
      title: t('cargo'),
      fields: [
        {
          kind: 'number',
          name: 'grossWeightKg',
          label: t('weight'),
          span: 4,
          step: '0.001',
          min: 0,
          suffix: 'kg',
          defaultValue: asTyped(enquiry.grossWeightKg),
        },
        {
          kind: 'number',
          name: 'volumeCbm',
          label: t('volume'),
          span: 4,
          step: '0.001',
          min: 0,
          suffix: 'cbm',
          defaultValue: asTyped(enquiry.volumeCbm),
        },
        {
          kind: 'number',
          name: 'pieces',
          label: t('pieces'),
          span: 4,
          min: 0,
          defaultValue: enquiry.pieces,
        },
        {
          kind: 'number',
          name: 'containerCount',
          label: t('containers'),
          span: 6,
          step: '1',
          min: 1,
          hint: t('containersHint'),
          defaultValue: enquiry.containerCount,
        },
        {
          kind: 'select',
          name: 'containerType',
          label: t('containerType'),
          span: 6,
          options: withCurrent(options.containerTypes, enquiry.containerType, null),
          defaultValue: enquiry.containerType,
          placeholder: t('none'),
        },
        {
          kind: 'switch',
          name: 'isDangerous',
          label: t('dangerous'),
          hint: t('dangerousHint'),
          span: 12,
          defaultChecked: enquiry.isDangerous,
        },
        {
          kind: 'textarea',
          name: 'notes',
          label: t('notes'),
          span: 12,
          rows: 3,
          hint: t('notesHint'),
          defaultValue: enquiry.notes,
        },
      ],
    },
  ]

  return (
    <RecordDialog
      action={updateEnquiry}
      icon="edit"
      size="lg"
      variant="secondary"
      fields={fields}
      labels={{
        open: t('editOpen'),
        title: t('editTitle'),
        description: t('editDescription'),
        submit: t('editSubmit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
        success: t('editDone'),
      }}
    />
  )
}
