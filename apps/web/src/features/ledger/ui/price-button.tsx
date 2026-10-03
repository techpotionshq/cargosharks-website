'use client'

/**
 * "Price it" — FR-EQ-05, and the twenty seconds Moment 2 is sold on.
 *
 * A submit button rather than a dialog, because the whole claim is that it
 * takes no input: the enquiry already carries the lane, the mode, the
 * readiness date and the cargo, and asking for any of it again would be the
 * manual quotation with extra steps.
 *
 * A client component only so the pending state and the refusal can be shown.
 * `useFormStatus` has to be inside the form it reports on, which is why the
 * button is its own component rather than markup on the page.
 *
 * ## Why this owns the whole page header
 *
 * The refusal and the button come out of one `useActionState`, and they belong
 * in two different places on the screen: the button in the header's action
 * row, the refusal full-width underneath it. Rendered together — which is what
 * the first version did — the message became a `max-w-xs` column wedged
 * between two buttons, knocking the action bar out of alignment every time a
 * lane turned out to be uncovered.
 *
 * So the header is passed *through* this component instead. Its title, its
 * eyebrow and its other actions arrive as already-rendered server nodes and
 * are placed around the button; nothing about them crosses the boundary as
 * data, and the page above stays a server component with its translations
 * resolved where the rest of the product resolves them.
 */

import type { ReactNode } from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { priceEnquiry } from '../pricing'
import { Button, PageHeader } from '@/ui/layout'
import { Notice } from '@/ui/notice'
import type { ActionState } from '@/lib/form-state'

function Submit({ label, working }: { readonly label: string; readonly working: string }) {
  const { pending } = useFormStatus()
  return (
    // `live`, not `quotes` — the manual quotation dialog beside it already
    // wears the scales, and two buttons in one bar under the same glyph read
    // as the same button rendered twice.
    <Button type="submit" variant="primary" icon="live" disabled={pending}>
      {pending ? working : label}
    </Button>
  )
}

export function EnquiryPricingHeader({
  enquiryId,
  labels,
  eyebrow,
  title,
  description,
  actionsBefore,
  actionsAfter,
  canPrice,
}: {
  readonly enquiryId: string
  readonly labels: { readonly price: string; readonly pricing: string }
  readonly eyebrow?: ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  /** Server-rendered siblings, kept in the order they are reached for. */
  readonly actionsBefore?: ReactNode
  readonly actionsAfter?: ReactNode
  /** A closed enquiry is a record; there is nothing left to price. */
  readonly canPrice: boolean
}) {
  const [state, action] = useActionState<ActionState, FormData>(priceEnquiry, {})

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        className={state.message ? 'mb-3' : undefined}
        actions={
          <>
            {actionsBefore}
            {canPrice ? (
              <form action={action}>
                <input type="hidden" name="enquiryId" value={enquiryId} />
                <Submit label={labels.price} working={labels.pricing} />
              </form>
            ) : null}
            {actionsAfter}
          </>
        }
      />

      {/*
        The refusal, in full, across the content column.

        Every one of them is something the coordinator can act on — load the
        card, set a house margin, raise an RFQ — so a toast that disappears
        would be the wrong shape, and truncating it would remove the half that
        says what to do. It stays until the next attempt.
      */}
      {state.message ? (
        <Notice tone="caution" className="mb-6">
          {state.message}
          {/* The way to the fix, where the refusal has one: the customer's
              commercial terms for a missing house margin (D8). */}
          {state.link ? (
            <>
              {' '}
              <a href={state.link.href} className="font-medium underline underline-offset-2">
                {state.link.label}
              </a>
            </>
          ) : null}
        </Notice>
      ) : null}
    </>
  )
}
