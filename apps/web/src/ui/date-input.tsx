'use client'

/**
 * A date control that shows its day the way the rest of the app writes one.
 *
 * `<input type="date">` draws its value in the *browser's* format, so an
 * English browser in Kuwait showed "10/05/2026" — the fifth of October to an
 * American, the tenth of May to everyone else, and in English digits on an
 * Arabic screen. The value submitted is always ISO and was never the problem;
 * only the reading was.
 *
 * So the native control stays (its picker, its keyboard entry, its `min`,
 * `max` and `required` all keep working) and, while it is not being edited, a
 * label in the app's own format sits over its text: "10 Oct 2026", or the
 * Arabic month with Latin digits as every other date in the product. Focus
 * reveals the native text again, because typing into a field you cannot read
 * is worse than a moment of the browser's format.
 */

import { useState, type InputHTMLAttributes } from 'react'
import { useLocale } from 'next-intl'

function readable(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  // The same options as `formatDate` in `lib/format.ts`; UTC because the
  // value is a calendar day, not an instant.
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function DateInput({
  defaultValue,
  className,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'defaultValue' | 'value'> & {
  readonly defaultValue?: string | null
}) {
  const locale = useLocale()
  const [value, setValue] = useState(defaultValue ?? '')
  const label = readable(value, locale)

  return (
    <span className="relative block">
      <input
        {...rest}
        type="date"
        defaultValue={defaultValue ?? ''}
        onChange={(event) => {
          setValue(event.target.value)
          onChange?.(event)
        }}
        className={[
          'peer',
          className,
          // Hidden text, not a hidden control: the picker button stays.
          // Important: the control classes set their own ink, which would win.
          label ? 'text-transparent! focus:text-ink!' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {label ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-body font-normal tracking-normal text-ink normal-case peer-focus:hidden"
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
