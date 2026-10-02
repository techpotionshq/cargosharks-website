'use client'

/**
 * The customer form.
 *
 * A client component because it renders server-side field errors against the
 * inputs that produced them and keeps what was typed — the two things a form
 * has to do that a plain POST cannot. Everything it submits goes to a server
 * action; there is no client-side fetch and no API route.
 */

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { CustomerFormState } from '../actions'
import { FOCUS_RING } from '@/ui/control'

export interface BranchOption {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly currency: string
}

export interface CountryOption {
  readonly code: string
  readonly name: string
}

export interface CustomerFormLabels {
  readonly identity: string
  readonly code: string
  readonly codeHint: string
  readonly legalNameEn: string
  readonly legalNameAr: string
  readonly registration: string
  readonly taxRegistration: string
  readonly country: string
  readonly branch: string
  readonly isActive: string
  readonly terms: string
  readonly termsHint: string
  readonly paymentTermsDays: string
  readonly creditLimit: string
  readonly creditCurrency: string
  readonly freeTimeDays: string
  readonly defaultIncoterm: string
  readonly submit: string
  readonly submitting: string
  readonly saved: string
  /**
   * The empty option in every select on this form.
   *
   * Not "None": in a list of incoterms "None" reads as one of them — a term
   * the operator chose — rather than as the absence of a choice. The dashed
   * prompt used everywhere else in the product says the same thing without
   * pretending to be a value.
   */
  readonly choose: string
}

export interface CustomerDefaults {
  readonly customerId?: string
  readonly code?: string
  readonly legalNameEn?: string
  readonly legalNameAr?: string | null
  readonly registration?: string | null
  readonly taxRegistration?: string | null
  readonly countryCode?: string | null
  readonly primaryBranchId?: string | null
  readonly isActive?: boolean
  readonly paymentTermsDays?: number
  readonly creditLimit?: string | null
  readonly creditCurrency?: string | null
  readonly freeTimeDays?: number | null
  readonly defaultIncoterm?: string | null
}

const FIELD = `h-10 w-full rounded-sm border border-line-strong bg-surface-sunken px-3 text-[0.9375rem] text-ink transition-colors focus:bg-surface ${FOCUS_RING}`
const FIELD_ERROR = 'border-critical bg-critical-soft/40'

function Field({
  label,
  name,
  error,
  hint,
  children,
  span = 6,
}: {
  readonly label: string
  readonly name: string
  readonly error?: string
  readonly hint?: string
  readonly children: React.ReactNode
  readonly span?: 3 | 4 | 6 | 12
}) {
  const spanClass =
    span === 12
      ? 'sm:col-span-12'
      : span === 6
        ? 'sm:col-span-6'
        : span === 4
          ? 'sm:col-span-4'
          : 'sm:col-span-3'

  return (
    <div className={`col-span-12 ${spanClass}`}>
      <label htmlFor={name} className="eyebrow mb-1.5 block">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-[0.75rem] font-medium text-critical">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[0.75rem] text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

function Submit({ labels }: { readonly labels: CustomerFormLabels }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-sm bg-brand px-5 text-[0.875rem] font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-60"
    >
      {pending ? labels.submitting : labels.submit}
    </button>
  )
}

export function CustomerForm({
  action,
  branches,
  countries,
  labels,
  defaults = {},
}: {
  readonly action: (state: CustomerFormState, form: FormData) => Promise<CustomerFormState>
  readonly branches: readonly BranchOption[]
  readonly countries: readonly CountryOption[]
  readonly labels: CustomerFormLabels
  readonly defaults?: CustomerDefaults
}) {
  const [state, formAction] = useActionState<CustomerFormState, FormData>(action, {})

  // A rejected submission echoes what was typed; the first render uses the
  // record. `??` rather than `||` so an intentionally cleared field stays clear.
  const value = (key: keyof CustomerDefaults, fallback?: string | number | null): string => {
    const echoed = state.values?.[key]
    if (echoed !== undefined) return echoed
    const initial = defaults[key] ?? fallback
    return initial === null || initial === undefined ? '' : String(initial)
  }

  const error = (key: string): string | undefined => state.errors?.[key]

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {defaults.customerId ? (
        <input type="hidden" name="customerId" value={defaults.customerId} />
      ) : null}

      {state.message === 'saved' ? (
        <p
          role="status"
          className="rounded-sm bg-positive-soft px-3 py-2 text-[0.8125rem] font-medium text-positive ring-1 ring-positive/25 ring-inset"
        >
          {labels.saved}
        </p>
      ) : null}

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-4 font-display text-[0.9375rem] font-semibold text-ink">
          {labels.identity}
        </h2>

        <div className="grid grid-cols-12 gap-4">
          <Field
            label={labels.code}
            name="code"
            error={error('code')}
            hint={labels.codeHint}
            span={4}
          >
            <input
              id="code"
              name="code"
              required
              dir="ltr"
              defaultValue={value('code')}
              className={`${FIELD} ref uppercase ${error('code') ? FIELD_ERROR : ''}`}
            />
          </Field>

          <Field
            label={labels.legalNameEn}
            name="legalNameEn"
            error={error('legalNameEn')}
            span={4}
          >
            <input
              id="legalNameEn"
              name="legalNameEn"
              required
              defaultValue={value('legalNameEn')}
              className={`${FIELD} ${error('legalNameEn') ? FIELD_ERROR : ''}`}
            />
          </Field>

          <Field
            label={labels.legalNameAr}
            name="legalNameAr"
            error={error('legalNameAr')}
            span={4}
          >
            <input
              id="legalNameAr"
              name="legalNameAr"
              dir="rtl"
              lang="ar"
              defaultValue={value('legalNameAr')}
              className={`${FIELD} font-arabic ${error('legalNameAr') ? FIELD_ERROR : ''}`}
            />
          </Field>

          <Field
            label={labels.branch}
            name="primaryBranchId"
            error={error('primaryBranchId')}
            span={4}
          >
            <select
              id="primaryBranchId"
              name="primaryBranchId"
              required
              defaultValue={value('primaryBranchId')}
              className={`${FIELD} ${error('primaryBranchId') ? FIELD_ERROR : ''}`}
            >
              <option value="">{labels.choose}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} · {branch.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={labels.country} name="countryCode" error={error('countryCode')} span={4}>
            <select
              id="countryCode"
              name="countryCode"
              defaultValue={value('countryCode')}
              className={FIELD}
            >
              <option value="">{labels.choose}</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={labels.registration}
            name="registration"
            error={error('registration')}
            span={4}
          >
            <input
              id="registration"
              name="registration"
              dir="ltr"
              defaultValue={value('registration')}
              className={FIELD}
            />
          </Field>

          <Field
            label={labels.taxRegistration}
            name="taxRegistration"
            error={error('taxRegistration')}
            span={4}
          >
            <input
              id="taxRegistration"
              name="taxRegistration"
              dir="ltr"
              defaultValue={value('taxRegistration')}
              className={FIELD}
            />
          </Field>

          <div className="col-span-12 flex items-center gap-2.5 sm:col-span-8">
            <input
              id="isActive"
              name="isActive"
              type="checkbox"
              defaultChecked={
                state.values ? state.values['isActive'] !== undefined : (defaults.isActive ?? true)
              }
              className="size-4 rounded-sm accent-[var(--qb-brand)]"
            />
            <label htmlFor="isActive" className="text-[0.875rem] text-ink">
              {labels.isActive}
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-[0.9375rem] font-semibold text-ink">{labels.terms}</h2>
        <p className="mt-1 mb-4 text-[0.8125rem] text-ink-muted">{labels.termsHint}</p>

        <div className="grid grid-cols-12 gap-4">
          <Field
            label={labels.paymentTermsDays}
            name="paymentTermsDays"
            error={error('paymentTermsDays')}
            span={3}
          >
            <input
              id="paymentTermsDays"
              name="paymentTermsDays"
              type="number"
              min={0}
              max={365}
              dir="ltr"
              defaultValue={value('paymentTermsDays', 30)}
              className={`${FIELD} numeric ${error('paymentTermsDays') ? FIELD_ERROR : ''}`}
            />
          </Field>

          <Field
            label={labels.creditLimit}
            name="creditLimit"
            error={error('creditLimit')}
            span={3}
          >
            <input
              id="creditLimit"
              name="creditLimit"
              inputMode="decimal"
              dir="ltr"
              defaultValue={value('creditLimit')}
              className={`${FIELD} numeric ${error('creditLimit') ? FIELD_ERROR : ''}`}
            />
          </Field>

          <Field
            label={labels.creditCurrency}
            name="creditCurrency"
            error={error('creditCurrency')}
            span={3}
          >
            <select
              id="creditCurrency"
              name="creditCurrency"
              defaultValue={value('creditCurrency')}
              className={FIELD}
            >
              <option value="">{labels.choose}</option>
              {[...new Set(branches.map((b) => b.currency))].map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={labels.freeTimeDays}
            name="freeTimeDays"
            error={error('freeTimeDays')}
            span={3}
          >
            <input
              id="freeTimeDays"
              name="freeTimeDays"
              type="number"
              min={0}
              max={120}
              dir="ltr"
              defaultValue={value('freeTimeDays')}
              className={`${FIELD} numeric`}
            />
          </Field>

          <Field
            label={labels.defaultIncoterm}
            name="defaultIncoterm"
            error={error('defaultIncoterm')}
            span={3}
          >
            <select
              id="defaultIncoterm"
              name="defaultIncoterm"
              defaultValue={value('defaultIncoterm')}
              className={FIELD}
            >
              <option value="">{labels.choose}</option>
              {['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'].map(
                (term) => (
                  <option key={term} value={term}>
                    {term}
                  </option>
                ),
              )}
            </select>
          </Field>
        </div>

        {/*
          The submit belongs to the card, not to the page.

          Loose at the foot of a wide screen it was a button floating in the
          margin with nothing to say what it saved. The negative margins pull
          this row out to the card's own edges so it becomes a footer on the
          thing it submits rather than the next item down the page, and
          `justify-end` leaves it where the eye leaves a form in either script.
        */}
        <div className="-mx-5 -mb-5 mt-5 flex items-center justify-end gap-3 rounded-b-card border-t border-line bg-surface-sunken px-5 py-4">
          <Submit labels={labels} />
        </div>
      </section>
    </form>
  )
}
