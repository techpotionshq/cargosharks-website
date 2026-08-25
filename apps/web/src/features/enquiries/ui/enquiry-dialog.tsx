'use client'

/**
 * The new-enquiry dialog.
 *
 * A dialog rather than a page, and that is the usability decision this whole
 * screen turns on. An enquiry arrives while you are looking at something else
 * — the board, a customer, another enquiry — and a full-page form makes you
 * lose that place to record a phone call. The dialog keeps the context behind
 * it and puts you back where you were.
 *
 * The form is ordered the way the phone call goes, not the way the table is:
 * who is asking, what is moving, from where to where, when. A form laid out in
 * column order makes the person taking the call jump around it.
 *
 * Only four fields are actually required — branch, and one of customer or
 * contact email. Everything else is what you happen to know when the call
 * ends, and demanding a commodity code before an enquiry can be recorded is
 * how enquiries end up in someone's inbox instead.
 */

import { useActionState, useId } from 'react'
import { submitEnquiry } from '../form-actions'
import type { Choice } from '@/lib/options'
import type { ActionState } from '@/lib/form-state'
import {
  ChoiceCards,
  FormError,
  FormGrid,
  FormSection,
  Input,
  Select,
  Submit,
  Switch,
  Textarea,
} from '@/ui/form'
import { Icon } from '@/ui/icon'
import { Modal, ModalCancel } from '@/ui/modal'

export interface EnquiryDialogLabels {
  readonly open: string
  readonly title: string
  readonly description: string
  readonly who: string
  readonly whoHint: string
  readonly branch: string
  readonly customer: string
  readonly customerHint: string
  readonly contactName: string
  readonly contactEmail: string
  readonly channel: string
  readonly owner: string
  readonly ownerHint: string
  readonly what: string
  readonly mode: string
  readonly direction: string
  readonly commodity: string
  readonly incoterm: string
  readonly incotermHint: string
  readonly lane: string
  readonly origin: string
  readonly destination: string
  readonly readyOn: string
  readonly readyOnHint: string
  readonly cargo: string
  readonly weight: string
  readonly volume: string
  readonly pieces: string
  readonly dangerous: string
  readonly dangerousHint: string
  readonly notes: string
  readonly notesHint: string
  readonly submit: string
  readonly submitting: string
  readonly cancel: string
  readonly none: string
  readonly modes: Record<string, string>
  readonly directions: Record<string, string>
  readonly channels: Record<string, string>
}

export interface EnquiryDialogOptions {
  readonly branches: readonly Choice[]
  readonly customers: readonly Choice[]
  readonly locations: readonly Choice[]
  readonly commodities: readonly Choice[]
  readonly incoterms: readonly Choice[]
  readonly people: readonly Choice[]
}

export function EnquiryDialog({
  labels,
  options,
  defaultBranchId,
  variant = 'primary',
}: {
  readonly labels: EnquiryDialogLabels
  readonly options: EnquiryDialogOptions
  readonly defaultBranchId?: string
  readonly variant?: 'primary' | 'secondary'
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitEnquiry, {})
  const error = (key: string) => state.errors?.[key]
  const value = (key: string) => state.values?.[key]
  const formId = useId()

  return (
    <Modal
      title={labels.title}
      description={labels.description}
      icon="enquiries"
      size="lg"
      closeOn={state.ok}
      closeLabel={labels.cancel}
      trigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          className={
            variant === 'primary'
              ? 'inline-flex h-9 items-center gap-1.5 rounded-sm bg-brand px-3.5 text-[0.875rem] font-semibold text-on-brand transition-colors hover:bg-brand-hover'
              : 'inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3.5 text-[0.875rem] font-medium text-ink transition-colors hover:bg-surface-sunken'
          }
        >
          <Icon name="plus" size={16} weight="bold" />
          {labels.open}
        </button>
      )}
      /*
        Cancel and Submit sit in the dialog's footer, which does not scroll —
        this form runs to three sections and the way to send it used to be
        below the fold on every screen smaller than a desktop.

        The footer is a sibling of the `<form>`, so the button reaches it by
        `form=` and `useFormStatus` cannot see across that boundary. Hence the
        explicit `pending`: without it the button would never disable and a
        second click would create a second enquiry.
      */
      footer={
        <>
          <ModalCancel>{labels.cancel}</ModalCancel>
          <Submit form={formId} pending={pending} pendingLabel={labels.submitting} icon="plus">
            {labels.submit}
          </Submit>
        </>
      }
    >
      <form id={formId} action={formAction}>
        <FormGrid>
          <FormError message={state.message} />

          <FormSection title={labels.who} hint={labels.whoHint}>
            <Select
              label={labels.branch}
              name="branchId"
              span={6}
              required
              options={options.branches}
              defaultValue={value('branchId') ?? defaultBranchId}
              placeholder={options.branches.length === 1 ? undefined : labels.none}
              error={error('branchId')}
            />
            <Select
              label={labels.owner}
              name="ownerId"
              span={6}
              options={options.people}
              defaultValue={value('ownerId')}
              placeholder={labels.none}
              hint={labels.ownerHint}
              error={error('ownerId')}
            />
            <Select
              label={labels.customer}
              name="customerId"
              span={12}
              options={options.customers}
              defaultValue={value('customerId')}
              placeholder={labels.none}
              hint={labels.customerHint}
              error={error('customerId')}
            />
            <Input
              label={labels.contactName}
              name="contactName"
              span={4}
              defaultValue={value('contactName')}
              error={error('contactName')}
            />
            <Input
              label={labels.contactEmail}
              name="contactEmail"
              type="email"
              span={4}
              defaultValue={value('contactEmail')}
              error={error('contactEmail')}
            />
            <Select
              label={labels.channel}
              name="channel"
              span={4}
              options={Object.entries(labels.channels).map(([key, label]) => ({
                value: key,
                label,
              }))}
              defaultValue={value('channel') ?? 'email'}
              error={error('channel')}
            />
          </FormSection>

          <FormSection title={labels.what}>
            <ChoiceCards
              label={labels.mode}
              name="mode"
              options={[
                { value: 'sea_fcl', label: labels.modes.sea_fcl ?? 'Sea FCL', icon: 'container' },
                { value: 'sea_lcl', label: labels.modes.sea_lcl ?? 'Sea LCL', icon: 'ship' },
                { value: 'air', label: labels.modes.air ?? 'Air', icon: 'plane' },
                { value: 'land', label: labels.modes.land ?? 'Land', icon: 'truck' },
              ]}
              defaultValue={value('mode')}
              error={error('mode')}
            />
            <ChoiceCards
              label={labels.direction}
              name="tradeDirection"
              options={Object.entries(labels.directions).map(([key, label]) => ({
                value: key,
                label,
              }))}
              defaultValue={value('tradeDirection')}
              error={error('tradeDirection')}
            />
            <Select
              label={labels.commodity}
              name="commodityId"
              span={6}
              options={options.commodities}
              defaultValue={value('commodityId')}
              placeholder={labels.none}
              error={error('commodityId')}
            />
            <Select
              label={labels.incoterm}
              name="incoterm"
              span={6}
              options={options.incoterms}
              defaultValue={value('incoterm')}
              placeholder={labels.none}
              hint={labels.incotermHint}
              error={error('incoterm')}
            />
          </FormSection>

          <FormSection title={labels.lane}>
            <Select
              label={labels.origin}
              name="originId"
              span={4}
              options={options.locations}
              defaultValue={value('originId')}
              placeholder={labels.none}
              error={error('originId')}
            />
            <Select
              label={labels.destination}
              name="destinationId"
              span={4}
              options={options.locations}
              defaultValue={value('destinationId')}
              placeholder={labels.none}
              error={error('destinationId')}
            />
            <Input
              label={labels.readyOn}
              name="readyOn"
              type="date"
              span={4}
              defaultValue={value('readyOn')}
              hint={labels.readyOnHint}
              error={error('readyOn')}
            />
          </FormSection>

          <FormSection title={labels.cargo}>
            <Input
              label={labels.weight}
              name="grossWeightKg"
              type="number"
              step="0.001"
              min={0}
              span={4}
              suffix="kg"
              defaultValue={value('grossWeightKg')}
              error={error('grossWeightKg')}
            />
            <Input
              label={labels.volume}
              name="volumeCbm"
              type="number"
              step="0.001"
              min={0}
              span={4}
              suffix="cbm"
              defaultValue={value('volumeCbm')}
              error={error('volumeCbm')}
            />
            <Input
              label={labels.pieces}
              name="pieces"
              type="number"
              min={0}
              span={4}
              defaultValue={value('pieces')}
              error={error('pieces')}
            />
            <Switch
              label={labels.dangerous}
              name="isDangerous"
              hint={labels.dangerousHint}
              span={12}
            />
            <Textarea
              label={labels.notes}
              name="notes"
              span={12}
              rows={3}
              hint={labels.notesHint}
              defaultValue={value('notes')}
              error={error('notes')}
            />
          </FormSection>
        </FormGrid>
      </form>
    </Modal>
  )
}
