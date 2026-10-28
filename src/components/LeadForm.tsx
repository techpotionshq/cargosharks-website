'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { DEMO_URL, type Lang, pilot } from '@/content/copy'
import { EmailLink } from './Email'

type State = 'idle' | 'sending' | 'done' | 'missing' | 'busy' | 'failed'

/**
 * The pilot request form. Posts to `/contact/`, which saves a lead and tells
 * Slack; nothing is mailed to the address typed here.
 *
 * `elapsedMs` is how long the form was open before it was sent, measured here
 * on one clock: the route turns away anything sent faster than a person can
 * type. It used to send the start time and let the server subtract, which
 * compared this device's clock with the server's: a phone running a minute
 * fast looked like a bot, and its lead was dropped behind a "thank you". `website` is a field no person sees.
 * Both answer bots without a captcha a forwarder's sales manager has to solve.
 */
export function LeadForm({ lang }: { lang: Lang }) {
  const [state, setState] = useState<State>('idle')
  const [startedAt] = useState(() => Date.now())
  const F = pilot.fields

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
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
      setState(
        res.ok ? 'done' : res.status === 429 ? 'busy' : res.status === 400 ? 'missing' : 'failed',
      )
    } catch {
      setState('failed')
    }
  }

  if (state === 'done')
    return (
      <div className="rounded-xl border border-line bg-paper-lift p-8 shadow-sm" role="status">
        <CheckCircle weight="fill" className="size-8 text-positive" aria-hidden="true" />
        <p className="mt-4 font-display text-[1.4rem] font-medium text-ink">
          {pilot.done.title[lang]}
        </p>
        <p className="mt-3 text-[0.95rem] leading-[1.7] text-ink-dim">{pilot.done.body[lang]}</p>
        <a
          href={DEMO_URL}
          className="tracked group mt-6 inline-flex items-center gap-2.5 rounded-lg bg-blue px-6 py-3.5 text-[0.62rem] leading-none text-on-brand transition-opacity hover:opacity-90"
        >
          {lang === 'ar' ? 'افتحوا النسخة التجريبية' : 'Open the live demo'}
          <ArrowRight weight="bold" className="size-3.5 rtl:-scale-x-100" />
        </a>
      </div>
    )

  const field =
    'mt-1.5 block w-full rounded-lg border border-line-strong bg-paper-lift px-3.5 py-2.5 text-[0.95rem] text-ink placeholder:text-ink-faint focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20'
  const label = 'block text-[0.82rem] font-medium text-ink'
  const error =
    state === 'missing' || state === 'busy' || state === 'failed' ? pilot.error[state] : null

  return (
    <form
      onSubmit={submit}
      noValidate
      className="rounded-xl border border-line bg-paper-lift p-6 shadow-sm sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
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
          {F.phone[lang]} <span className="font-normal text-ink-faint">({F.optional[lang]})</span>
          <input name="phone" type="tel" autoComplete="tel" dir="ltr" className={field} />
        </label>
        <label className={label}>
          {F.country[lang]}
          <select name="country" defaultValue="" className={field}>
            <option value="" disabled>
              {F.choose[lang]}
            </option>
            {pilot.countries.map((c) => (
              <option key={c.value} value={c.value}>
                {c[lang]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {F.volume[lang]}
          <select name="volume" defaultValue="" className={field}>
            <option value="" disabled>
              {F.choose[lang]}
            </option>
            {pilot.volumes.map((v) => (
              <option key={v.value} value={v.value}>
                {v[lang]}
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>
          {F.message[lang]}
          <textarea name="message" rows={3} className={field} />
        </label>
        {/* For bots only: hidden from people and from screen readers. */}
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -start-[9999px] h-px w-px opacity-0"
        />
      </div>

      {error ? (
        <p role="alert" className="mt-5 text-[0.88rem] text-amber">
          {error[lang]}{' '}
          {state !== 'missing' ? (
            <EmailLink className="underline">{lang === 'ar' ? 'البريد' : 'Email'}</EmailLink>
          ) : null}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="submit"
          disabled={state === 'sending'}
          className="tracked group inline-flex items-center gap-2.5 rounded-lg bg-blue px-7 py-4 text-[0.66rem] leading-none text-on-brand transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {state === 'sending' ? pilot.sending[lang] : pilot.submit[lang]}
          <ArrowRight
            weight="bold"
            className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
          />
        </button>
        <p className="text-[0.8rem] text-ink-faint">
          <a href="/privacy/" className="hover:underline">
            {pilot.privacy[lang]}
          </a>
        </p>
      </div>
    </form>
  )
}
