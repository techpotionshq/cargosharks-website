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

import { useActionState, useEffect, useId, useRef, type ReactNode } from 'react'
import type { ActionState } from '@/lib/form-state'
import {
  ChoiceCards,
  FileInput,
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
import { MENU_ITEM, MENU_ITEM_DANGER, buttonClass } from './control'
import { useInMenu } from './menu'
import { toast } from './toast'

interface BaseField {
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
  /**
   * A file the form posts as part of its `FormData`.
   *
   * No `defaultValue` and never echoed, and that is a property of file inputs
   * rather than an omission: a browser refuses to let a page set one, for the
   * obvious reason that a page which could would be a page that can read any
   * path it can name. So a rejected submission re-renders with the chooser
   * empty and the person picks the file again — which is the behaviour every
   * upload form on the web has, and worth stating because it looks like the
   * echo bug the comment above `echoed` describes.
   *
   * `accept` is a hint to the file picker and nothing more. The server decides
   * what it will store; see `ALLOWED_UPLOAD_TYPES` in the service.
   */
  | (BaseField & {
      readonly kind: 'file'
      readonly accept?: string
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

interface RecordDialogLabels {
  readonly open: string
  readonly title: string
  readonly description?: string
  readonly submit: string
  readonly submitting: string
  readonly cancel: string
  /**
   * What the confirmation says once it worked — "Invoice issued", "Enquiry
   * assigned". Omitted, the region's own "Saved." is used, which is right for
   * an edit and too vague for a move that changes a record's state.
   */
  readonly success?: string
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

/*
  All four triggers are `Button`'s own `md`, and that is the point.

  These buttons share action bars with `Button` — the enquiry header alone
  carries three of them next to "Price it". `ghost` used to be `h-8`, which is
  invisible in isolation and obvious in a row: two dialogs, a link and a
  submit, none of them agreeing on a baseline. Quiet is carried by colour and
  by the missing border; it is not carried by being four pixels shorter than
  its neighbours. The shared `buttonClass` is what keeps it that way.
*/
const TRIGGER: Record<NonNullable<RecordDialogProps['variant']>, string> = {
  primary: buttonClass('primary', 'md'),
  secondary: buttonClass('secondary', 'md'),
  ghost: buttonClass('ghost', 'md'),
  // The trigger is outlined; the filled red is saved for the confirm inside.
  danger: buttonClass('danger-outline', 'md'),
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
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {})
  /*
    The form's id, so the submit button can sit outside it.

    Cancel and Submit used to be the last row *of the field grid*, which put
    them inside the dialog's scrolling body: open the outbound-mail dialog and
    the way to save it was two screens below the fold, under a dozen fields
    nobody had to change. They belong in the footer, which does not scroll —
    and the footer is a sibling of the form, not a descendant, so the button is
    associated by `form=` the way HTML has always allowed.

    That association is also why `pending` is threaded through by hand:
    `useFormStatus` reports on a form the button is *rendered inside*, and this
    one no longer is. `useActionState` already knows, so it is the source.
  */
  const formId = useId()
  const inMenu = useInMenu()

  /*
    Say so when it worked.

    The dialog closing was the only acknowledgement there was, and a dialog
    also closes when it is cancelled — so after a status move nothing on the
    screen distinguished "issued" from "never mind". Keyed on the token, like
    the close itself, so two successes in a row both announce.
  */
  const announced = useRef(state.ok)
  useEffect(() => {
    if (state.ok && state.ok !== announced.current) {
      announced.current = state.ok
      toast(labels.success)
    }
  }, [state.ok, labels.success])

  return (
    <Modal
      title={labels.title}
      description={labels.description}
      icon={icon}
      size={size}
      closeOn={state.ok}
      closeLabel={labels.cancel}
      footer={
        <>
          <ModalCancel>{labels.cancel}</ModalCancel>
          <Submit
            form={formId}
            pending={pending}
            pendingLabel={labels.submitting}
            icon={submitIcon}
            variant={variant === 'danger' ? 'danger' : 'primary'}
          >
            {labels.submit}
          </Submit>
        </>
      }
      trigger={
        trigger ??
        (({ onClick }) => (
          <button
            type="button"
            onClick={onClick}
            title={iconOnly ? labels.open : undefined}
            aria-label={iconOnly ? labels.open : undefined}
            className={
              inMenu
                ? variant === 'danger'
                  ? MENU_ITEM_DANGER
                  : MENU_ITEM
                : iconOnly
                  ? 'flex size-9 items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink max-md:size-10'
                  : TRIGGER[variant]
            }
          >
            <Icon
              name={icon ?? 'plus'}
              size={iconOnly || inMenu ? 16 : 15}
              weight={inMenu ? 'regular' : 'bold'}
              className={inMenu && variant !== 'danger' ? 'text-ink-subtle' : undefined}
            />
            {iconOnly ? null : labels.open}
          </button>
        ))
      }
    >
      <form id={formId} action={formAction}>
        <FormGrid>
          <FormError message={state.message} />
          {fields.map((field, index) => (
            <RenderField key={fieldKey(field, index)} field={field} state={state} />
          ))}
        </FormGrid>
      </form>
    </Modal>
  )
}

/** Sections and notes have no `name`, so the index stands in for one. */
/*
  The index is part of the key, and that is not belt-and-braces.

  A repeated `name` is deliberate in this form vocabulary: branch access
  renders one switch per branch, all called `branchIds`, so the browser submits
  an array (FR-ID-02). Keying on the name alone therefore gave every one of
  those switches the same key, and React warned about duplicate children on
  every render of the user dialog — with two branches it merely warned, but the
  documented consequence is a child being duplicated or dropped, which here
  would be a branch grant silently missing from the form.

  Fields are built in a fixed order and never reordered or filtered between
  renders, so pairing the name with its position is stable.
*/
function fieldKey(field: FieldSpec, index: number): string {
  if (field.kind === 'section') return `section:${field.title}`
  if (field.kind === 'note') return `note:${index}`
  return `${field.name}:${index}`
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
    case 'file':
      return <FileInput {...common} accept={field.accept} />

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
