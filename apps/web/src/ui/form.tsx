'use client'

/**
 * The form kit.
 *
 * Fourteen entities in this product take a create-and-edit form, and before
 * this file existed the first two of them had already drifted: different field
 * heights, different error placement, one that lost what you typed on a
 * validation failure and one that did not. So the pieces live here once.
 *
 * Three things every field in the product does, which is why they are baked in
 * rather than left to call sites:
 *
 *   1. **The label is a real `<label for>`.** Not a `<p>` above an input.
 *      Clicking the word focuses the field, and a screen reader announces the
 *      two together.
 *   2. **The error replaces the hint, in the same place.** A message that
 *      appears *below* the hint reflows the form on every failed submit.
 *   3. **`aria-invalid` and `aria-describedby` are wired.** A red border is
 *      not an error message to anyone not looking at it.
 *
 * The inputs are uncontrolled and carry `defaultValue`. The server action
 * echoes back what was typed on rejection, and React re-mounts with those
 * defaults — so there is no per-keystroke state anywhere in this file, and a
 * forty-field job form stays as cheap to type into as a text box.
 */

import { useActionState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Icon, type IconName } from './icon'

/** The state every server action in the application returns. */
export interface FormState {
  /** Field-keyed messages, so each input renders its own. */
  readonly errors?: Record<string, string>
  /** Something that failed for a reason no single field owns. */
  readonly message?: string
  /** Set on success. Changing it is what closes a dialog. */
  readonly ok?: string
  /** Echoed back so a rejected form does not lose what was typed. */
  readonly values?: Record<string, string>
}

export type ServerAction = (state: FormState, form: FormData) => Promise<FormState>

// --- layout ----------------------------------------------------------------

/**
 * The twelve-column form grid.
 *
 * Twelve rather than a fixed two or three, because these forms mix a full-width
 * legal name with a pair of half-width dates and a row of four short codes, and
 * a rigid column count forces one of those to be wrong.
 */
export function FormGrid({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div className={['grid grid-cols-12 gap-x-4 gap-y-4', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}

/** A titled band inside a long form. Hairline, not a nested card. */
export function FormSection({
  title,
  hint,
  children,
}: {
  readonly title: ReactNode
  readonly hint?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="col-span-12">
      <div className="rule-title mb-3">
        <h3 className="text-[0.8125rem] font-semibold tracking-wide text-ink uppercase">{title}</h3>
      </div>
      {hint ? <p className="-mt-1 mb-3 text-[0.8125rem] text-ink-muted">{hint}</p> : null}
      <FormGrid>{children}</FormGrid>
    </section>
  )
}

export type Span = 2 | 3 | 4 | 6 | 8 | 12

const SPAN: Record<Span, string> = {
  2: 'col-span-6 sm:col-span-2',
  3: 'col-span-6 sm:col-span-3',
  4: 'col-span-12 sm:col-span-4',
  6: 'col-span-12 sm:col-span-6',
  8: 'col-span-12 sm:col-span-8',
  12: 'col-span-12',
}

// --- controls --------------------------------------------------------------

const CONTROL =
  'h-10 w-full rounded-sm border bg-surface px-3 text-[0.875rem] text-ink transition-colors placeholder:text-ink-subtle focus:outline-none disabled:opacity-60'
const CONTROL_REST = 'border-line hover:border-line-strong focus:border-brand'
const CONTROL_BAD = 'border-critical bg-critical-soft/30 focus:border-critical'

function controlClass(invalid: boolean, extra?: string): string {
  return [CONTROL, invalid ? CONTROL_BAD : CONTROL_REST, extra].filter(Boolean).join(' ')
}

export interface FieldProps {
  readonly label: ReactNode
  readonly name: string
  readonly span?: Span
  readonly hint?: ReactNode
  readonly error?: string
  readonly required?: boolean
  readonly children?: ReactNode
}

/** The label / control / message wrapper. Every control below uses it. */
export function Field({ label, name, span = 6, hint, error, required, children }: FieldProps) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined

  return (
    <div className={SPAN[span]}>
      <label
        htmlFor={name}
        className="mb-1.5 block text-[0.75rem] font-semibold tracking-wide text-ink-muted uppercase"
      >
        {label}
        {required ? (
          <span className="ms-1 text-critical" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p
          id={describedBy}
          role="alert"
          className="mt-1.5 flex items-center gap-1 text-[0.75rem] font-medium text-critical"
        >
          <Icon name="alert" size={12} weight="fill" />
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mt-1.5 text-[0.75rem] text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export interface InputProps extends Omit<FieldProps, 'children'> {
  readonly type?:
    | 'text'
    | 'email'
    | 'tel'
    | 'url'
    | 'number'
    | 'date'
    | 'datetime-local'
    | 'search'
    /** A credential being typed in. Masks the field; says nothing about storage. */
    | 'password'
  readonly defaultValue?: string | number | null
  readonly placeholder?: string
  readonly step?: string
  readonly min?: string | number
  readonly max?: string | number
  readonly maxLength?: number
  readonly readOnly?: boolean
  readonly autoFocus?: boolean
  /** Renders the value monospaced — references, container and bill numbers. */
  readonly mono?: boolean
  /** A fixed suffix inside the control: a currency, a unit, `%`. */
  readonly suffix?: ReactNode
}

export function Input({
  type = 'text',
  defaultValue,
  placeholder,
  step,
  min,
  max,
  maxLength,
  readOnly,
  autoFocus,
  mono,
  suffix,
  ...field
}: InputProps) {
  const invalid = Boolean(field.error)
  const control = (
    <input
      id={field.name}
      name={field.name}
      type={type}
      defaultValue={defaultValue ?? ''}
      placeholder={placeholder}
      step={step}
      min={min}
      max={max}
      maxLength={maxLength}
      readOnly={readOnly}
      autoFocus={autoFocus}
      required={field.required}
      aria-invalid={invalid || undefined}
      aria-describedby={field.error ? `${field.name}-error` : undefined}
      className={controlClass(
        invalid,
        [mono ? 'ref' : '', type === 'number' ? 'numeric' : '', suffix ? 'pe-12' : '']
          .filter(Boolean)
          .join(' '),
      )}
    />
  )

  return (
    <Field {...field}>
      {suffix ? (
        <div className="relative">
          {control}
          <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[0.75rem] font-medium text-ink-subtle">
            {suffix}
          </span>
        </div>
      ) : (
        control
      )}
    </Field>
  )
}

export interface Option {
  readonly value: string
  readonly label: string
  /** Grouped under an `<optgroup>` — branches by country, charges by category. */
  readonly group?: string
}

export function Select({
  options,
  defaultValue,
  placeholder,
  ...field
}: Omit<FieldProps, 'children'> & {
  readonly options: readonly Option[]
  readonly defaultValue?: string | null
  /** The empty first row. Omit it to force a choice on a required field. */
  readonly placeholder?: string
}) {
  const invalid = Boolean(field.error)
  const groups = [...new Set(options.map((o) => o.group).filter(Boolean))] as string[]

  const rows = groups.length
    ? groups.map((group) => (
        <optgroup key={group} label={group}>
          {options
            .filter((o) => o.group === group)
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </optgroup>
      ))
    : options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))

  return (
    <Field {...field}>
      <select
        id={field.name}
        name={field.name}
        defaultValue={defaultValue ?? ''}
        required={field.required}
        aria-invalid={invalid || undefined}
        aria-describedby={field.error ? `${field.name}-error` : undefined}
        className={controlClass(invalid, 'appearance-none bg-no-repeat pe-9 qb-select')}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {rows}
      </select>
    </Field>
  )
}

export function Textarea({
  defaultValue,
  placeholder,
  rows = 3,
  ...field
}: Omit<FieldProps, 'children'> & {
  readonly defaultValue?: string | null
  readonly placeholder?: string
  readonly rows?: number
}) {
  const invalid = Boolean(field.error)
  return (
    <Field {...field}>
      <textarea
        id={field.name}
        name={field.name}
        rows={rows}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        required={field.required}
        aria-invalid={invalid || undefined}
        aria-describedby={field.error ? `${field.name}-error` : undefined}
        className={[
          'w-full resize-y rounded-sm border bg-surface px-3 py-2 text-[0.875rem] leading-relaxed text-ink transition-colors placeholder:text-ink-subtle focus:outline-none',
          invalid ? CONTROL_BAD : CONTROL_REST,
        ].join(' ')}
      />
    </Field>
  )
}

/**
 * A switch.
 *
 * Rendered as a real checkbox with a drawn track, so it submits with the form
 * and is reachable by keyboard without a single line of JavaScript. The label
 * sits to the side and is part of the same `<label>`, which makes the whole
 * row the hit target — a 16px checkbox is not a usable target on a phone.
 */
export function Switch({
  label,
  name,
  hint,
  defaultChecked = false,
  span = 6,
}: {
  readonly label: ReactNode
  readonly name: string
  readonly hint?: ReactNode
  readonly defaultChecked?: boolean
  readonly span?: Span
}) {
  return (
    <div className={SPAN[span]}>
      <label
        htmlFor={name}
        className="flex cursor-pointer items-start gap-3 rounded-sm border border-line bg-surface p-3 transition-colors hover:border-line-strong has-checked:border-brand/40 has-checked:bg-brand-soft/40"
      >
        <input
          id={name}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          className="peer sr-only"
        />
        {/*
          The knob is a *descendant* of the track, not a sibling of the input,
          so `peer-checked:` cannot reach it directly — the peer variant
          compiles to a sibling combinator. Both the track colour and the knob
          position are therefore driven from the track, which is a sibling.
        */}
        <span
          aria-hidden
          className="mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors peer-checked:bg-brand peer-checked:[&>span]:translate-x-4 rtl:peer-checked:[&>span]:-translate-x-4"
        >
          <span className="size-4 rounded-full bg-surface shadow-card transition-transform" />
        </span>
        <span className="min-w-0">
          <span className="block text-[0.875rem] font-medium text-ink">{label}</span>
          {hint ? (
            <span className="mt-0.5 block text-[0.75rem] text-ink-subtle">{hint}</span>
          ) : null}
        </span>
      </label>
    </div>
  )
}

/**
 * A radio group drawn as cards.
 *
 * For the four-to-six-way choices this domain is full of — transport mode,
 * severity, declaration type. A `<select>` hides the options behind a click;
 * these are the decisions where seeing all the choices at once is the point.
 */
export function ChoiceCards({
  name,
  options,
  defaultValue,
  span = 12,
  ...field
}: Omit<FieldProps, 'children'> & {
  readonly options: readonly { value: string; label: string; icon?: IconName; hint?: string }[]
  readonly defaultValue?: string | null
}) {
  return (
    <Field {...field} name={name} span={span}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer flex-col items-start gap-1 rounded-sm border border-line bg-surface p-3 transition-colors hover:border-line-strong has-checked:border-brand has-checked:bg-brand-soft/50 has-checked:ring-1 has-checked:ring-brand/30"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={defaultValue === option.value}
              className="sr-only"
            />
            {option.icon ? <Icon name={option.icon} size={18} className="text-ink-muted" /> : null}
            <span className="text-[0.8125rem] font-medium text-ink">{option.label}</span>
            {option.hint ? (
              <span className="text-[0.6875rem] text-ink-subtle">{option.hint}</span>
            ) : null}
          </label>
        ))}
      </div>
    </Field>
  )
}

// --- submission ------------------------------------------------------------

/** The banner for a failure no single field owns. */
export function FormError({ message }: { readonly message?: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="col-span-12 flex items-start gap-2 rounded-sm border border-critical/40 bg-critical-soft/60 px-3 py-2.5 text-[0.8125rem] text-critical"
    >
      <Icon name="alert" size={15} className="mt-px shrink-0" />
      <span>{message}</span>
    </div>
  )
}

/**
 * The submit button.
 *
 * Its own component because `useFormStatus` only reports the status of the
 * form it is *rendered inside* — read from the component that owns the form
 * and it always says idle. Disabling while pending is what stops a double
 * submit creating two job files.
 */
export function Submit({
  children,
  pendingLabel,
  icon = 'check',
  variant = 'primary',
}: {
  readonly children: ReactNode
  readonly pendingLabel?: ReactNode
  readonly icon?: IconName
  readonly variant?: 'primary' | 'danger'
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={[
        'inline-flex h-9 items-center gap-1.5 rounded-sm px-4 text-[0.875rem] font-semibold transition-colors disabled:opacity-60',
        variant === 'danger'
          ? 'bg-critical text-on-brand hover:opacity-90'
          : 'bg-brand text-on-brand hover:bg-brand-hover',
      ].join(' ')}
    >
      {pending ? (
        <Icon name="clock" size={15} className="animate-spin" />
      ) : (
        <Icon name={icon} size={15} weight="bold" />
      )}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  )
}

/**
 * Binds a server action to a form and hands back the pieces a caller needs.
 *
 * The `value()` helper is the important part: it prefers what the failed
 * submission echoed back, falls back to the record being edited, and returns
 * `''` for absent — with `??` rather than `||`, so a field the user
 * deliberately *cleared* stays cleared instead of springing back to its old
 * value on the next render.
 */
export function useEntityForm(action: ServerAction, defaults: Record<string, unknown> = {}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {})

  const value = (key: string, fallback?: string | number | null): string => {
    const echoed = state.values?.[key]
    if (echoed !== undefined) return echoed
    const initial = defaults[key] ?? fallback
    return initial === null || initial === undefined ? '' : String(initial)
  }

  const checked = (key: string, fallback = false): boolean => {
    if (state.values) return state.values[key] !== undefined
    const initial = defaults[key]
    return initial === undefined ? fallback : Boolean(initial)
  }

  return {
    state,
    formAction,
    value,
    checked,
    error: (key: string) => state.errors?.[key],
  }
}
