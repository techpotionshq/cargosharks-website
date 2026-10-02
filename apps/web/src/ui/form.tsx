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

import { useId, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Icon, type IconName } from './icon'
import {
  CONTROL,
  CONTROL_BAD,
  CONTROL_BASE,
  CONTROL_INVALID,
  CONTROL_REST,
  buttonClass,
} from './control'

// --- layout ----------------------------------------------------------------

/**
 * The twelve-column form grid.
 *
 * Twelve rather than a fixed two or three, because these forms mix a full-width
 * legal name with a pair of half-width dates and a row of four short codes, and
 * a rigid column count forces one of those to be wrong.
 *
 * It is also the grid the fields *borrow*. Each `Field` spans three of this
 * grid's rows — label, control, message — and subgrids them, so that the three
 * bands line up across every field sharing a visual row no matter how many
 * lines each label happens to take. See `Field` for why that matters.
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
        <h3 className="text-body-sm font-semibold tracking-wide text-ink uppercase">{title}</h3>
      </div>
      {hint ? <p className="-mt-1 mb-3 text-body-sm text-ink-muted">{hint}</p> : null}
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

// The strings themselves live in `control.ts`, which says why focus is not
// drawn in the brand colour and why they are not exported from here.
function controlClass(invalid: boolean, extra?: string): string {
  return [invalid ? CONTROL_INVALID : CONTROL, extra].filter(Boolean).join(' ')
}

/**
 * What a control is described by: its error when it has one, otherwise its
 * hint.
 *
 * The hint used to be wired to nothing — `Field` gave it an id and no control
 * pointed at it, so "Whoever will price and answer this enquiry" was read to
 * a sighted person and never to anyone using a screen reader.
 */
function describedBy(field: { name: string; error?: string; hint?: ReactNode }) {
  return field.error ? `${field.name}-error` : field.hint ? `${field.name}-hint` : undefined
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

/*
  Three rows of the parent grid, borrowed.

  A field is three stacked things — label, control, message — and left as an
  ordinary block each one stacks against *its own* label. So the moment one
  label in a row wraps to two lines and its neighbours do not, that field's
  input drops eighteen pixels below theirs and a row of three date pickers
  reads as three separate rows of one. It is not hypothetical: "Their invoice
  date" wraps in a three-column slot and "Due" never will, and Arabic wraps in
  different places again, so no amount of shortening the English fixes it.

  `grid-rows-subgrid` makes the three bands belong to the *form* rather than to
  the field. Every field in a visual row draws its label from the same track,
  its control from the same track and its message from the same track, and the
  tallest label sets the height for all of them. Nothing has to be measured and
  nothing has to be guessed at translation time.

  Two details that are load-bearing and look like noise:

    - `grid-cols-1` — the inner grid's implicit column would otherwise be
      `auto`, which sizes to the label's *max-content* and pushes the whole
      field out past its column. Measured: a 121px slot rendering 151px wide.
    - `gap-y-0` — a subgrid uses its own gutters for the tracks it spans, so
      without this the parent's `gap-y-4` lands between a label and its input.
      The margins on the label and the message do that spacing instead.
*/
const FIELD_BAND = 'row-span-3 grid grid-cols-1 grid-rows-subgrid gap-y-0'

/** The label / control / message wrapper. Every control below uses it. */
export function Field({ label, name, span = 6, hint, error, required, children }: FieldProps) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined

  return (
    <div className={`${SPAN[span]} ${FIELD_BAND}`}>
      <label
        htmlFor={name}
        className="mb-1.5 block text-caption font-semibold tracking-wide text-ink-muted uppercase"
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
          className="mt-1.5 flex items-center gap-1 text-caption font-medium text-critical"
        >
          <Icon name="alert" size={12} weight="fill" />
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mt-1.5 text-caption text-ink-subtle">
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
      /*
        The field takes its direction from what is in it, not from the page.

        Half these forms carry a matched pair — legal name and legal name in
        Arabic, an English notification template beside its Arabic one — and
        under an English interface the Arabic one rendered as a left-to-right
        paragraph: the full stop jumped to the head of the line and a
        `{{placeholder}}` landed on the wrong side of the sentence it belonged
        to. `auto` is the platform's answer, resolved per field from the first
        strong character, and it is inert for the numeric and date types.
      */
      dir="auto"
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
      aria-describedby={describedBy(field)}
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
          <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-caption font-medium text-ink-subtle">
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
        aria-describedby={describedBy(field)}
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
        /* Per-field direction — see the same attribute on `Input`. */
        dir="auto"
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        required={field.required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(field)}
        className={[
          CONTROL_BASE,
          'resize-y px-3 py-2 text-body leading-relaxed',
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
  value,
  hint,
  defaultChecked = false,
  span = 6,
}: {
  readonly label: ReactNode
  readonly name: string
  /*
    What a checked box submits. Omitted, the browser sends "on", which is
    right for a lone yes/no and wrong for a group: the branch switches on the
    user form all submitted "on" under one name, so the server received
    ["on", "on"] for "these two branches" and every invitation failed a uuid
    check (QA P1-3). A grouped switch passes the option's own value.
  */
  readonly value?: string
  readonly hint?: ReactNode
  readonly defaultChecked?: boolean
  readonly span?: Span
}) {
  /*
    One id per box, not per name. A group shared `id="branchIds"`, so every
    label pointed at the first checkbox and clicking "DXB" toggled "KWI" — and
    a page renders many dialogs at once, so every edit row's "Active" switch
    was `id="isActive"` and its label toggled the first one in the document,
    not its own (QA P1-3, P2-13). Scoped by `useId`, unique on the page.
  */
  const scope = useId()
  const id = `${scope}-${name}${value === undefined ? '' : `-${value}`}`
  return (
    // `row-span-3` even though a switch has no label band of its own: it makes
    // the switch occupy the same three rows a `Field` does, so one sitting
    // beside an input squares off with the whole field rather than with the
    // input's label. Without it the grid gives the switch a row of its own and
    // the two controls stop being a row.
    <div className={`${SPAN[span]} row-span-3`}>
      {/*
        `h-full` so a pair of switches on one row squares off.

        Two of these side by side are almost never the same height — one
        carries a hint and the other does not, and the hint wraps to two lines
        at the width half a dialog gives it. Sized to its own content, the
        shorter box floats with its bottom edge halfway up its neighbour and
        the two read as different kinds of control rather than the same control
        twice. The grid cell already stretches; this is the label taking it.
      */}
      <label
        htmlFor={id}
        /*
          The ring is drawn on the label because the input is `sr-only`: a
          visually hidden checkbox can take focus, but its own outline is a
          one-pixel square nobody can see, so a keyboard user tabbing through a
          dialog lost track of where they were the moment they reached a switch.
        */
        className="flex h-full cursor-pointer items-start gap-3 rounded-sm border border-line bg-surface p-3 transition-colors hover:border-line-strong has-checked:border-accent/40 has-checked:bg-accent-soft/50 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
      >
        <input
          id={id}
          name={name}
          value={value}
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
          className="mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors peer-checked:bg-accent peer-checked:[&>span]:translate-x-4 rtl:peer-checked:[&>span]:-translate-x-4"
        >
          <span className="size-4 rounded-full bg-surface shadow-card transition-transform" />
        </span>
        <span className="min-w-0">
          <span className="block text-body font-medium text-ink">{label}</span>
          {hint ? <span className="mt-0.5 block text-caption text-ink-subtle">{hint}</span> : null}
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
            /*
              Selected in the accent rather than the brand. A red card around
              the chosen option read as the *wrong* choice — on "How did it
              end?" the selected "Won" looked like an error — and the same
              `has-focus-visible` ring as `Switch`, for the same reason.
            */
            className="flex cursor-pointer flex-col items-start gap-1 rounded-sm border border-line bg-surface p-3 transition-colors hover:border-line-strong has-checked:border-accent has-checked:bg-accent-soft/60 has-checked:ring-1 has-checked:ring-accent/30 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={defaultValue === option.value}
              className="sr-only"
            />
            {option.icon ? <Icon name={option.icon} size={18} className="text-ink-muted" /> : null}
            <span className="text-body-sm font-medium text-ink">{option.label}</span>
            {option.hint ? <span className="text-micro text-ink-subtle">{option.hint}</span> : null}
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
      className="col-span-12 flex items-start gap-2 rounded-sm border border-critical/40 bg-critical-soft/60 px-3 py-2.5 text-body-sm text-critical"
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
  form,
  pending: reported,
}: {
  readonly children: ReactNode
  readonly pendingLabel?: ReactNode
  readonly icon?: IconName
  readonly variant?: 'primary' | 'danger'
  /**
   * The id of a form this button is *not* inside — a dialog footer, which is a
   * sibling of the form so that it does not scroll with the fields.
   *
   * `useFormStatus` cannot see across that boundary, so a caller passing
   * `form` must pass `pending` too. `useActionState` returns it.
   */
  readonly form?: string
  readonly pending?: boolean
}) {
  const status = useFormStatus()
  const pending = reported ?? status.pending
  return (
    <button
      type="submit"
      form={form}
      disabled={pending}
      className={buttonClass(variant === 'danger' ? 'danger' : 'primary', 'md')}
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
 * A file chooser, styled to sit in the same grid as everything else.
 *
 * The native control is left in place rather than replaced by a button and a
 * hidden input. A custom chooser has to re-implement keyboard focus, the
 * drag-and-drop target and the selected-file name, and gets one of them wrong;
 * `::file-selector-button` styles the half that actually looks foreign.
 *
 * No `defaultValue`, because a browser will not let a page set one — a page
 * that could would be a page that can read any path it can name. So a rejected
 * submission comes back with the chooser empty and the person picks the file
 * again, which is how every upload form on the web behaves.
 */
export function FileInput({
  accept,
  ...field
}: Omit<FieldProps, 'children'> & { readonly accept?: string }) {
  const invalid = Boolean(field.error)

  return (
    <Field {...field}>
      <input
        id={field.name}
        name={field.name}
        type="file"
        accept={accept}
        required={field.required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(field)}
        className={controlClass(
          invalid,
          'py-1.5 file:me-3 file:rounded-sm file:border-0 file:bg-surface-sunken ' +
            'file:px-3 file:py-1.5 file:text-caption file:font-semibold file:text-ink-muted ' +
            'hover:file:bg-line file:cursor-pointer',
        )}
      />
    </Field>
  )
}
