'use client'

/**
 * Issuing and revoking a customer's API key — FR-AD-05.
 *
 * A client component, unusually for a dialog in this codebase, and for one
 * reason: the secret exists exactly once, in the action's reply, and must be
 * put in front of the operator before the dialog closes. Every other form here
 * can close on success because the record it wrote can be read back. This one
 * cannot — there is nothing to read back, by design.
 */

import { useActionState } from 'react'
import {
  createApiKey,
  createWebhookEndpoint,
  revokeApiKey,
  setWebhookEndpointActive,
} from '../api-keys'
import { Button } from '@/ui/layout'
import type { ActionState } from '@/lib/form-state'

export function CreateApiKeyForm({
  customers,
  branches,
  labels,
}: {
  readonly customers: readonly { value: string; label: string }[]
  readonly branches: readonly { value: string; label: string }[]
  readonly labels: Record<string, string>
}) {
  const [state, action] = useActionState<ActionState, FormData>(createApiKey, {})

  // `succeed` suffixes a counter; the token before the last colon is the key.
  const issued = state.ok ? state.ok.slice(0, state.ok.lastIndexOf(':')) : null

  return (
    <div className="rounded-card border border-line p-4">
      <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="eyebrow">{labels.name}</span>
          <input
            name="name"
            required
            placeholder={labels.namePlaceholder}
            className="rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.875rem]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">{labels.customer}</span>
          <select
            name="customerId"
            required
            className="rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.875rem]"
          >
            <option value="">{labels.choose}</option>
            {customers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">{labels.branch}</span>
          <select
            name="branchId"
            required
            className="rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.875rem]"
          >
            {branches.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="eyebrow">{labels.expires}</span>
          <input
            type="date"
            name="expiresAt"
            className="rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.875rem]"
          />
          <span className="text-[0.6875rem] text-ink-subtle">{labels.expiresHint}</span>
        </label>

        <div className="flex items-end sm:col-span-2">
          <Button type="submit" variant="primary" icon="plus">
            {labels.issue}
          </Button>
        </div>
      </form>

      {state.errors
        ? Object.entries(state.errors).map(([field, message]) => (
            <p key={field} className="mt-2 text-[0.8125rem] text-critical">
              {message}
            </p>
          ))
        : null}
      {state.message ? (
        <p className="mt-2 text-[0.8125rem] text-critical">{state.message}</p>
      ) : null}

      {/*
        The one moment the secret exists outside the action.

        Loud, selectable, and stated as final — there is no hash to reverse and
        no second chance, so an operator who closes this page without copying
        it has to revoke and re-issue.
      */}
      {issued ? (
        <div className="mt-4 rounded-sm border border-caution/40 bg-caution-soft/50 p-3">
          <p className="text-[0.8125rem] font-medium text-caution">{labels.onceOnly}</p>
          <code className="ref mt-2 block break-all rounded-sm bg-surface px-2.5 py-2 text-[0.8125rem] select-all">
            {issued}
          </code>
        </div>
      ) : null}
    </div>
  )
}

export function RevokeApiKeyButton({ keyId, label }: { readonly keyId: string; readonly label: string }) {
  const [state, action] = useActionState<ActionState, FormData>(revokeApiKey, {})

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="keyId" value={keyId} />
      <Button type="submit" variant="ghost" size="sm" icon="close">
        {label}
      </Button>
      {state.message ? (
        <span className="text-[0.6875rem] text-caution">{state.message}</span>
      ) : null}
    </form>
  )
}

/**
 * Subscribing a URL to events — FR-AD-06.
 *
 * The secret is shown once here too, and for a different reason from the API
 * key's: it is stored in clear because the worker signs every delivery with
 * it. Showing it once is a courtesy to the receiver, who needs it to verify —
 * not a security property.
 */
export function CreateWebhookForm({
  customers,
  branches,
  labels,
}: {
  readonly customers: readonly { value: string; label: string }[]
  readonly branches: readonly { value: string; label: string }[]
  readonly labels: Record<string, string>
}) {
  const [state, action] = useActionState<ActionState, FormData>(createWebhookEndpoint, {})
  const secret = state.ok ? state.ok.slice(0, state.ok.lastIndexOf(':')) : null

  return (
    <div className="rounded-card border border-line p-4">
      <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-4">
          <span className="eyebrow">{labels.url}</span>
          <input
            name="url"
            required
            type="url"
            placeholder="https://…"
            className="ref rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.875rem]"
          />
          <span className="text-[0.6875rem] text-ink-subtle">{labels.urlHint}</span>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="eyebrow">{labels.customer}</span>
          <select
            name="customerId"
            className="rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.875rem]"
          >
            {/* Empty is a deployment-wide subscriber — the operator's own
                systems, rather than one customer's. */}
            <option value="">{labels.everyCustomer}</option>
            {customers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="eyebrow">{labels.branch}</span>
          <select
            name="branchId"
            className="rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.875rem]"
          >
            <option value="">{labels.everyBranch}</option>
            {branches.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-3">
          <span className="eyebrow">{labels.events}</span>
          <input
            name="events"
            placeholder="job.milestone_reached document.released"
            className="ref rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.875rem]"
          />
          <span className="text-[0.6875rem] text-ink-subtle">{labels.eventsHint}</span>
        </label>

        <div className="flex items-start sm:col-span-1">
          <Button type="submit" variant="primary" icon="plus">
            {labels.subscribe}
          </Button>
        </div>
      </form>

      {state.errors
        ? Object.entries(state.errors).map(([field, message]) => (
            <p key={field} className="mt-2 text-[0.8125rem] text-critical">
              {message}
            </p>
          ))
        : null}
      {state.message ? <p className="mt-2 text-[0.8125rem] text-critical">{state.message}</p> : null}

      {secret ? (
        <div className="mt-4 rounded-sm border border-caution/40 bg-caution-soft/50 p-3">
          <p className="text-[0.8125rem] font-medium text-caution">{labels.secretOnce}</p>
          <code className="ref mt-2 block break-all rounded-sm bg-surface px-2.5 py-2 text-[0.8125rem] select-all">
            {secret}
          </code>
        </div>
      ) : null}
    </div>
  )
}

/** Switch a subscriber off, or back on once their URL is fixed. */
export function ToggleWebhookButton({
  endpointId,
  isActive,
  labels,
}: {
  readonly endpointId: string
  readonly isActive: boolean
  readonly labels: { readonly enable: string; readonly disable: string }
}) {
  const [, action] = useActionState<ActionState, FormData>(setWebhookEndpointActive, {})

  return (
    <form action={action}>
      <input type="hidden" name="endpointId" value={endpointId} />
      {/* Presence is the signal, as everywhere else in this application. */}
      {isActive ? null : <input type="hidden" name="isActive" value="true" />}
      <Button type="submit" variant="ghost" size="sm" icon={isActive ? 'hold' : 'check'}>
        {isActive ? labels.disable : labels.enable}
      </Button>
    </form>
  )
}
