'use client'

/**
 * A `<select>` that submits its form the moment it changes.
 *
 * For a preference whose whole decision is the choice itself — the time zone
 * in the top bar. `requestSubmit` rather than `submit`, so the form's Server
 * Action runs exactly as it would from a button. Everything else about it is
 * the native control: keyboard, type-ahead and the platform picker on a phone.
 */

export function AutoSubmitSelect({
  id,
  name,
  defaultValue,
  className,
  options,
}: {
  readonly id: string
  readonly name: string
  readonly defaultValue: string
  readonly className?: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      className={className}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
