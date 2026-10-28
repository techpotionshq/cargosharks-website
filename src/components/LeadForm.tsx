'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, CalendarBlank, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { CALL_URL, DEMO_URL, enquiry, type Lang } from '@/content/copy'
import { EmailLink } from './Email'

type State = 'idle' | 'sending' | 'done' | 'missing' | 'email' | 'busy' | 'failed'

/**
 * The demo request form. Posts to `/contact/`, which saves a lead and tells
 * Slack; nothing is mailed to the address typed here.
 *
 * **Contact first, then the operation.** Name, company and email are the only
 * required fields; the questions under "About your operation" are what a quote
 * depends on (branches, users, modes, current system, e-invoicing, timeline)
 * and every one is optional, because a question that blocks the form is a
 * reason not to send it. Answering them is what lets the first call be about
 * the visitor's shipments rather than a questionnaire.
 *
 * `elapsedMs` is how long the form was open before it was sent, measured here
 * on one clock: the route turns away anything sent faster than a person can
 * type. It used to send the start time and let the server subtract, which
 * compared this device's clock with the server's: a phone running a minute
 * fast looked like a bot, and its lead was dropped behind a "thank you".
 * `website` is a field no person sees. Both answer bots without a captcha a
 * forwarder's sales manager has to solve.
 */
export function LeadForm({ lang }: { lang: Lang }) {
  const [state, setState] = useState<State>('idle')
  const [startedAt] = useState(() => Date.now())
  const F = enquiry.fields

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    // `modes` is a group of checkboxes, so it is read as a list rather than
    // left to `fromEntries`, which would keep only the last one ticked.
    const data: Record<string, unknown> = {
      ...Object.fromEntries(form),
      modes: form.getAll('modes'),
    }
    if (!data.name || !data.company || !data.email) return setState('missing')
    setState('sending')
    try {
      const res = await fetch('/contact/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...data,
          elapsedMs: Date.now() - startedAt,
          lang,
          page: window.location.pathname,
        }),
      })
      if (res.status === 400) {
        // The route says which: a field left empty, or an address it refused.
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        return setState(error === 'email' ? 'email' : 'missing')
      }
      setState(res.ok ? 'done' : res.status === 429 ? 'busy' : 'failed')
    } catch {
      setState('failed')
    }
  }

  if (state === 'done')
    return (
      <div className="rounded-xl border border-line bg-paper-lift p-8 shadow-sm" role="status">
        <CheckCircle weight="fill" className="size-8 text-positive" aria-hidden="true" />
        <p className="mt-4 font-display text-h3 font-bold text-heading">
          {enquiry.done.title[lang]}
        </p>
        <p className="mt-2 text-body text-ink-dim">{enquiry.done.body[lang]}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <a href={CALL_URL} target="_blank" rel="noopener">
              <CalendarBlank weight="bold" className="size-4" aria-hidden="true" />
              {enquiry.done.book[lang]}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={DEMO_URL}>
              {lang === 'ar' ? 'افتحوا النسخة التجريبية' : 'Open the live demo'}
              <ArrowRight weight="bold" className="size-4 rtl:-scale-x-100" />
            </a>
          </Button>
        </div>
      </div>
    )

  const field =
    'mt-1.5 block h-11 w-full rounded-lg border border-input bg-paper-lift px-3 text-body text-ink placeholder:text-ink-faint focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20'
  const label = 'block text-small font-medium text-ink'
  const optional = <span className="font-normal text-ink-faint">({F.optional[lang]})</span>
  const error =
    state === 'missing' || state === 'email' || state === 'busy' || state === 'failed'
      ? enquiry.error[state]
      : null

  const select = (
    name: string,
    title: { en: string; ar: string },
    options: { value: string; en: string; ar: string }[],
  ) => (
    <label className={label}>
      {title[lang]}
      <select name={name} defaultValue="" className={field}>
        <option value="">{F.choose[lang]}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option[lang]}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <form
      onSubmit={submit}
      noValidate
      className="relative rounded-xl border border-line bg-paper-lift p-6 shadow-sm sm:p-8"
    >
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <label className={label}>
          {F.name[lang]}
          <input name="name" required autoComplete="name" className={field} />
        </label>
        <label className={label}>
          {F.company[lang]}
          <input name="company" required autoComplete="organization" className={field} />
        </label>
        <label className={label}>
          {F.email[lang]}
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            className={field}
          />
        </label>
        <label className={label}>
          {F.phone[lang]} {optional}
          <input name="phone" type="tel" autoComplete="tel" dir="ltr" className={field} />
        </label>
      </div>

      <fieldset className="mt-7 border-t border-line pt-6">
        <legend className="float-start text-small font-semibold text-ink">
          {F.about[lang]} {optional}
        </legend>
        <div className="clear-both grid gap-x-5 gap-y-4 pt-4 sm:grid-cols-2">
          {select('country', F.country, enquiry.countries)}
          {select('volume', F.volume, enquiry.volumes)}
          {select('branches', F.branches, enquiry.branchCounts)}
          {select('users', F.users, enquiry.userCounts)}
          {select('system', F.system, enquiry.systems)}
          {select('einvoicing', F.einvoicing, enquiry.einvoicingNeeds)}
          {select('timeline', F.timeline, enquiry.timelines)}

          <fieldset className="sm:col-span-2">
            <legend className={label}>{F.modes[lang]}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {enquiry.modeOptions.map((mode) => (
                <label
                  key={mode.value}
                  className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-input bg-paper-lift px-3 text-small text-ink transition-colors has-[:checked]:border-blue has-[:checked]:bg-blue/8 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue/30"
                >
                  <input
                    type="checkbox"
                    name="modes"
                    value={mode.value}
                    className="size-4 accent-blue"
                  />
                  {mode[lang]}
                </label>
              ))}
            </div>
          </fieldset>

          <label className={`${label} sm:col-span-2`}>
            {F.message[lang]}
            <textarea name="message" rows={3} className={`${field} h-auto py-2.5`} />
          </label>
        </div>
      </fieldset>

      {/* For bots only: hidden from people and from screen readers. Clipped in
          place rather than pushed 9999px to the start side, which in Arabic is
          the right, and gave the page a sideways scroll. */}
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="sr-only"
      />

      {error ? (
        <p role="alert" className="mt-5 text-small text-amber">
          {error[lang]}{' '}
          {state !== 'missing' && state !== 'email' ? (
            <EmailLink className="underline">{lang === 'ar' ? 'البريد' : 'Email'}</EmailLink>
          ) : null}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button type="submit" size="lg" disabled={state === 'sending'}>
          {state === 'sending' ? enquiry.sending[lang] : enquiry.submit[lang]}
          <ArrowRight weight="bold" className="size-4 rtl:-scale-x-100" />
        </Button>
        <p className="text-label text-ink-faint">
          <a href="/privacy/" className="hover:underline">
            {enquiry.privacy[lang]}
          </a>
        </p>
      </div>
    </form>
  )
}
