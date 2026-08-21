'use client'

/**
 * One dialog, driven by a field list.
 *
 * There are fifteen things in this product you can create or edit, and every
 * one of them wants the same dialog: a header, a grid of fields grouped into
 * sections, per-field server errors, a cancel and a submit that disables
 * itself. Written by hand that is fifteen files which are ninety per cent
 * identical and which drift apart the moment two people touch them.
 *
 * So the *shape* of a form is data — a `FieldSpec[]` — and this component
 * renders it. The specs are built on the server, which is where the options,
 * the permissions and the translations already are, and they cross to the
 * client as plain JSON.
 *
 * Two things this deliberately does **not** do, both because they would trade
 * a real property for a small convenience:
 *
 *   - **No client-side validation rules in the spec.** The schema on the
 *     server is the only validator. A second copy in the browser is a second
 *     thing to keep in step, and the first time they disagree the user is
 *     told their input is fine and then told it is not.
 *   - **No generated server action.** Each entity still writes its own action,
 *     because what makes those interesting is the permission check, the state
 *     transition and the transaction — none of which generalise.
 *
 * The result is that adding "create a partner" is a field list and a
 * thirty-line action, and it looks exactly like every other form in the
 * product without anyone having to remember to make it so.
 */

import { useActionState, type ReactNode } from 'react'
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
  type Option,
  type Span,
} from './form'
import { Icon, type IconName } from './icon'
import { Modal, ModalCancel, type ModalSize } from './modal'

export interface BaseField {
  readonly name: string
  readonly label: string
  readonly span?: Span
  readonly hint?: string
  readonly required?: boolean
}

export type FieldSpec =
  | (BaseField & {
      readonly kind:
        | 'text'
        | 'email'
        | 'tel'
        | 'url'
        | 'number'
        | 'date'
        | 'datetime-local'
        /*
          `password` renders `type="password"` and nothing else — the input
          type is the field kind. It exists so a credential is not typed in
          clear over somebody's shoulder; it is not a claim about storage,
          which is `sealSecret`'s job.

          A caller using this must also keep the field out of `echo()` on
          failure, or a rejected form re-renders the secret into the DOM.
        */
        | 'password'
      readonly defaultValue?: string | number | null
      readonly placeholder?: string
      readonly step?: string
      readonly min?: string | number
      readonly max?: string | number
      readonly maxLength?: number
      readonly mono?: boolean
      readonly suffix?: string
    })
  | (BaseField & {
      readonly kind: 'select'
      readonly options: readonly Option[]
      readonly defaultValue?: string | null
      readonly placeholder?: string
    })
  | (BaseField & {
      readonly kind: 'textarea'
      readonly defaultValue?: string | null
      readonly placeholder?: string
      readonly rows?: number
    })
  | (BaseField & {
      readonly kind: 'switch'
      readonly defaultChecked?: boolean
    })
  | (BaseField & {
      readonly kind: 'choices'
      readonly options: readonly { value: string; label: string; icon?: IconName; hint?: string }[]
      readonly defaultValue?: string | null
    })
  | {
      readonly kind: 'section'
      readonly title: string
      readonly hint?: string
      readonly fields: readonly FieldSpec[]
    }
  | {
      readonly kind: 'hidden'
      readonly name: string
      readonly value: string
    }
  /** Free-standing explanatory copy — a warning above a destructive field. */
  | {
      readonly kind: 'note'
      readonly text: string
      readonly tone?: 'info' | 'caution'
    }

export interface RecordDialogLabels {
  readonly open: string
  readonly title: string
  readonly description?: string
  readonly submit: string
  readonly submitting: string
  readonly cancel: string
}

export interface RecordDialogProps {
  readonly action: (state: ActionState, form: FormData) => Promise<ActionState>
  readonly fields: readonly FieldSpec[]
  readonly labels: RecordDialogLabels
  readonly icon?: IconName
  readonly size?: ModalSize
  readonly submitIcon?: IconName
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  /** Renders the trigger as an icon-only button — for a row's action column. */
  readonly iconOnly?: boolean
  /** Replaces the built-in trigger entirely. */
  readonly trigger?: (props: { onClick: () => void }) => ReactNode
}

const TRIGGER: Record<string, string> = {
  primary:
    'inline-flex h-9 items-center gap-1.5 rounded-sm bg-brand px-3.5 text-[0.875rem] font-semibold text-on-brand transition-colors hover:bg-brand-hover',
  secondary:
    'inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3.5 text-[0.875rem] font-medium text-ink transition-colors hover:bg-surface-sunken',
  ghost:
    'inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[0.8125rem] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink',
  danger:
    'inline-flex h-9 items-center gap-1.5 rounded-sm border border-critical/40 bg-surface px-3.5 text-[0.875rem] font-medium text-critical transition-colors hover:bg-critical-soft',
}

export function RecordDialog({
  action,
  fields,
  labels,
  icon,
  size = 'md',
  submitIcon = 'check',
  variant = 'primary',
  iconOnly = false,
  trigger,
}: RecordDialogProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {})

  return (
    <Modal
      title={labels.title}
      description={labels.description}
      icon={icon}
      size={size}
      closeOn={state.ok}
      closeLabel={labels.cancel}
      trigger={
        trigger ??
        (({ onClick }) => (
          <button
            type="button"
            onClick={onClick}
            title={iconOnly ? labels.open : undefined}
            aria-label={iconOnly ? labels.open : undefined}
            className={
              iconOnly
                ? 'flex size-8 items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink'
                : TRIGGER[variant]!
            }
          >
            <Icon name={icon ?? 'plus'} size={iconOnly ? 16 : 15} weight="bold" />
            {iconOnly ? null : labels.open}
          </button>
        ))
      }
    >
      <form action={formAction}>
        <FormGrid>
          <FormError message={state.message} />
          {fields.map((field, index) => (
            <RenderField key={fieldKey(field, index)} field={field} state={state} />
          ))}

          <div className="col-span-12 flex justify-end gap-2 border-t border-line pt-4">
            <ModalCancel>{labels.cancel}</ModalCancel>
            <Submit
              pendingLabel={labels.submitting}
              icon={submitIcon}
              variant={variant === 'danger' ? 'danger' : 'primary'}
            >
              {labels.submit}
            </Submit>
          </div>
        </FormGrid>
      </form>
    </Modal>
  )
}

/** Sections and notes have no `name`, so the index stands in for one. */
function fieldKey(field: FieldSpec, index: number): string {
  if (field.kind === 'section') return `section:${field.title}`
  if (field.kind === 'note') return `note:${index}`
  return field.name
}

function RenderField({ field, state }: { field: FieldSpec; state: ActionState }) {
  if (field.kind === 'section') {
    return (
      <FormSection title={field.title} hint={field.hint}>
        {field.fields.map((child, index) => (
          <RenderField key={fieldKey(child, index)} field={child} state={state} />
        ))}
      </FormSection>
    )
  }

  if (field.kind === 'hidden') {
    return <input type="hidden" name={field.name} value={field.value} />
  }

  if (field.kind === 'note') {
    return (
      <p
        className={[
          'col-span-12 flex items-start gap-2 rounded-sm px-3 py-2 text-[0.8125rem]',
          field.tone === 'caution'
            ? 'bg-caution-soft/60 text-caution'
            : 'bg-surface-sunken text-ink-muted',
        ].join(' ')}
      >
        <Icon
          name={field.tone === 'caution' ? 'alert' : 'dot'}
          size={14}
          className="mt-px shrink-0"
        />
        {field.text}
      </p>
    )
  }

  const error = state.errors?.[field.name]
  /**
   * A rejected submission's value wins over the record's.
   *
   * `??` rather than `||`, so a field the user deliberately *cleared* stays
   * cleared instead of springing back to its stored value on re-render — the
   * single most annoying bug a form can have.
   */
  const echoed = state.values?.[field.name]

  const common = {
    label: field.label,
    name: field.name,
    span: field.span,
    hint: field.hint,
    error,
    required: field.required,
  }

  switch (field.kind) {
    case 'select':
      return (
        <Select
          {...common}
          options={field.options}
          defaultValue={echoed ?? field.defaultValue}
          placeholder={field.placeholder}
        />
      )
    case 'textarea':
      return (
        <Textarea
          {...common}
          rows={field.rows}
          placeholder={field.placeholder}
          defaultValue={echoed ?? field.defaultValue}
        />
      )
    case 'switch':
      return (
        <Switch
          label={field.label}
          name={field.name}
          hint={field.hint}
          span={field.span}
          // On a rejected submit an unchecked box is absent from the FormData
          // entirely, so "present in values" is the only correct read.
          defaultChecked={
            state.values ? state.values[field.name] !== undefined : field.defaultChecked
          }
        />
      )
    case 'choices':
      return (
        <ChoiceCards
          {...common}
          options={field.options}
          defaultValue={echoed ?? field.defaultValue}
        />
      )
    default:
      return (
        <Input
          {...common}
          type={field.kind}
          defaultValue={echoed ?? field.defaultValue}
          placeholder={field.placeholder}
          step={field.step}
          min={field.min}
          max={field.max}
          maxLength={field.maxLength}
          mono={field.mono}
          suffix={field.suffix}
        />
      )
  }
}
