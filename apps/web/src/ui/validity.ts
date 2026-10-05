'use client'

/**
 * The app's own words for a control the browser has refused to submit.
 *
 * Every form relied on the browser's constraint messages — "Please fill out
 * this field." — and those follow the *browser's* language, not the app's. An
 * Arabic interface on an English browser answered every empty required field
 * in English, in a bubble the app could not style or translate. The browser
 * still decides *whether* a control is valid (`required`, `type="email"`,
 * `min`, `max`, `step`, `maxLength`, `pattern`), because those attributes are
 * already on every field and are the cheapest correct check there is. Only
 * the words, and where they appear, are the app's now:
 *
 * - inside a form-kit `Field` (every dialog and almost every form), the
 *   message is drawn under the control like a server error, and the bubble is
 *   suppressed — see `useFieldValidity`;
 * - on a bare control outside a `Field`, the bubble stays but carries the
 *   app's message in the app's language — see `ValidityMessages`.
 *
 * The server actions still validate everything. This is the first answer, not
 * the only one.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
type Translate = ReturnType<typeof useTranslations<'validation'>>

function isControl(target: EventTarget | null): target is Control {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  )
}

/** A `min`/`max` on a date control, written the way the app writes a day. */
function boundLabel(control: Control, value: string, locale: string): string {
  if (control instanceof HTMLInputElement && control.type === 'date' && value) {
    const date = new Date(`${value}T00:00:00Z`)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    }
  }
  return value
}

/**
 * The message for a control's current validity, or `null` when it is valid.
 * Pure apart from reading the control, so both mechanisms below share it.
 */
export function validityMessage(control: Control, t: Translate, locale: string): string | null {
  const v = control.validity
  if (v.valid) return null
  const input = control instanceof HTMLInputElement ? control : null
  const kind = input?.type ?? control.tagName.toLowerCase()

  if (v.valueMissing) {
    if (control instanceof HTMLSelectElement || kind === 'radio') return t('requiredChoice')
    if (kind === 'file') return t('requiredFile')
    if (kind === 'checkbox') return t('requiredCheck')
    return t('required')
  }
  if (v.typeMismatch) {
    if (kind === 'email') return t('validEmail')
    if (kind === 'url') return t('validUrl')
    return t('invalidType')
  }
  if (v.badInput) {
    if (kind === 'number') return t('expectedNumber')
    if (kind === 'date' || kind === 'datetime-local') return t('validDate')
    return t('invalidType')
  }
  if (v.rangeUnderflow && input) {
    const minimum = boundLabel(control, input.min, locale)
    return kind === 'date' ? t('dateTooEarly', { minimum }) : t('numberTooSmall', { minimum })
  }
  if (v.rangeOverflow && input) {
    const maximum = boundLabel(control, input.max, locale)
    return kind === 'date' ? t('dateTooLate', { maximum }) : t('numberTooBig', { maximum })
  }
  if (v.stepMismatch && input) return t('multipleOf', { divisor: input.step })
  if (v.tooShort && 'minLength' in control) return t('tooShort', { minimum: control.minLength })
  if (v.tooLong && 'maxLength' in control) return t('tooLong', { maximum: control.maxLength })
  if (v.patternMismatch) return t('checkFormat')
  return t('checkValue')
}

/*
  One submit fires `invalid` at every bad control in tree order, synchronously.
  Cancelling the event (which is what hides the bubble) also stops the browser
  focusing the first one, so the first one is focused here, once per submit.
*/
let focusedThisTurn = false
function focusFirst(control: Control): void {
  if (focusedThisTurn) return
  focusedThisTurn = true
  control.focus()
  setTimeout(() => {
    focusedThisTurn = false
  }, 0)
}

/**
 * Inline validity for one form-kit `Field`.
 *
 * Listens on the field's wrapper in the capture phase, because `invalid` does
 * not bubble but does pass every ancestor on the way down. Returns the message
 * to draw, and clears it as soon as the control becomes valid.
 */
export function useFieldValidity<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [message, setMessage] = useState<string | null>(null)
  const t = useTranslations('validation')
  const locale = useLocale()

  useEffect(() => {
    const wrapper = ref.current
    if (!wrapper) return

    const onInvalid = (event: Event) => {
      if (!isControl(event.target)) return
      event.preventDefault()
      event.target.setAttribute('aria-invalid', 'true')
      setMessage(validityMessage(event.target, t, locale))
      focusFirst(event.target)
    }
    const onEdit = (event: Event) => {
      if (!isControl(event.target)) return
      if (event.target.validity.valid) {
        event.target.removeAttribute('aria-invalid')
        setMessage(null)
      }
    }

    wrapper.addEventListener('invalid', onInvalid, true)
    wrapper.addEventListener('input', onEdit, true)
    wrapper.addEventListener('change', onEdit, true)
    return () => {
      wrapper.removeEventListener('invalid', onInvalid, true)
      wrapper.removeEventListener('input', onEdit, true)
      wrapper.removeEventListener('change', onEdit, true)
    }
  }, [t, locale])

  return { ref, message }
}

/**
 * The fallback for a control outside any `Field` — a sign-in box, a filter
 * row, a search. The bubble is the browser's, but its words are the app's:
 * `setCustomValidity` is set while the event is being reported, and cleared on
 * the next edit so the control can become valid again. Mounted once, in the
 * root layout.
 */
export function ValidityMessages(): null {
  const t = useTranslations('validation')
  const locale = useLocale()

  useEffect(() => {
    const onInvalid = (event: Event) => {
      const control = event.target
      if (!isControl(control) || control.closest('[data-qb-field]')) return
      // Recompute from the constraint alone, not from an earlier custom one.
      control.setCustomValidity('')
      const message = validityMessage(control, t, locale)
      if (message) control.setCustomValidity(message)
    }
    const onEdit = (event: Event) => {
      const control = event.target
      if (!isControl(control) || control.closest('[data-qb-field]')) return
      control.setCustomValidity('')
    }

    document.addEventListener('invalid', onInvalid, true)
    document.addEventListener('input', onEdit, true)
    document.addEventListener('change', onEdit, true)
    return () => {
      document.removeEventListener('invalid', onInvalid, true)
      document.removeEventListener('input', onEdit, true)
      document.removeEventListener('change', onEdit, true)
    }
  }, [t, locale])

  return null
}
