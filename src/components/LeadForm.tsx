'use client'

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, CalendarBlank, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { DEMO_URL, enquiry, type Lang } from '@/content/copy'
import { callUrl } from '@/lib/booking'
import { track } from '@/lib/track'
import { EmailLink } from './Email'

/** A select left on "Choose…" posts an empty string; GA4 reads that as a value. */
const optionalAnswer = (value: unknown) => (value ? String(value) : 'not_given')

type State = 'idle' | 'sending' | 'done' | 'missing' | 'email' | 'busy' | 'failed'

/**
 * The quote request form, on `/pricing/`. Posts to `/contact/`, which saves a
 * lead and tells Slack; nothing is mailed to the address typed here.
 *
 * **Short, and nothing a visitor would hesitate to give.** Name, company and
 * email are the only required fields. The optional ones are the shape of the
 * quote (country, branches, users, e-invoicing, when to go live): enough to
 * plan the call, nothing commercially sensitive. Volume, modes and the current
 * system were asked here too, and read to a forwarder like business data they
 * would rather say on a call than type into a stranger's form, so the call asks
 * them instead. A question that blocks the form is a reason not to send it.
 *
 * The thank-you offers the booking page with the name and email just typed
 * already filled in (`lib/booking.ts`), so picking a time is one click.
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
  // Kept from the moment of sending, for the booking link on the thank-you.
  const [person, setPerson] = useState<{ name?: string; email?: string }>({})
  const F = enquiry.fields

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget))
    if (!data.name || !data.company || !data.email) {
      track('form_error', { form_error: 'missing' })
      return setState('missing')
    }
    setPerson({ name: String(data.name), email: String(data.email) })
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
        const refused = error === 'email' ? 'email' : 'missing'
        track('form_error', { form_error: refused })
        return setState(refused)
      }
      const next = res.ok ? 'done' : res.status === 429 ? 'busy' : 'failed'
      if (next === 'done')
        // The conversion, and only after the server has saved the lead: an ad
        // platform optimising on a click of the button would learn to buy
        // visitors who press it with the form half empty. The qualifying
        // answers ride along so leads can be split by market and size; who
        // sent it never does.
        track('generate_lead', {
          lead_country: optionalAnswer(data.country),
          lead_branches: optionalAnswer(data.branches),
          lead_users: optionalAnswer(data.users),
          lead_einvoicing: optionalAnswer(data.einvoicing),
          lead_timeline: optionalAnswer(data.timeline),
        })
      else track('form_error', { form_error: next })
      setState(next)
    } catch {
      track('form_error', { form_error: 'network' })
      setState('failed')
    }
  }

  // Once per page view, on the first field the visitor touches: the gap between
  // this and `generate_lead` is how many people start the form and give up.
  const started = useRef(false)
  function onStart() {
    if (started.current) return
    started.current = true
    track('form_start')
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
            <a href={callUrl(person)} target="_blank" rel="noopener">
              <CalendarBlank weight="bold" className="size-4" aria-hidden="true" />
              {enquiry.done.book[lang]}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={DEMO_URL}>
              {lang === 'ar' ? 'جرّبوا النسخة التجريبية' : 'Try the demo'}
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
    // `data-clarity-mask`: Clarity's default masking already hides typed values,
    // but this form holds names, work emails and phone numbers, and the privacy
    // policy promises they never reach Microsoft. Masking the whole subtree
    // keeps that true even if someone loosens the project's setting later.
    <form
      data-clarity-mask="true"
      onFocus={onStart}
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
          {select('branches', F.branches, enquiry.branchCounts)}
          {select('users', F.users, enquiry.userCounts)}
          {select('einvoicing', F.einvoicing, enquiry.einvoicingNeeds)}
          {select('timeline', F.timeline, enquiry.timelines)}

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
