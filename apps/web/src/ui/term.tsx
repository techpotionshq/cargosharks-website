/**
 * Jargon, explained in place.
 *
 * Freight forwarding runs on about thirty words that mean nothing to anyone
 * outside it — demurrage, detention, incoterm, HBL, HS code, free time. A new
 * coordinator meets all of them in their first hour, and the usual answer is a
 * training document nobody opens.
 *
 * So the definition lives on the word. `<Term>` renders a dotted underline and
 * a native tooltip, and it is deliberately built on `title` rather than on a
 * JavaScript popover: it costs nothing, it works before hydration, it works on
 * a keyboard, and screen readers announce it. The trade is that it does not
 * appear on touch — which is why the glossary below is *also* rendered in full
 * on the reference page, and why the explanation is never the only place a
 * critical instruction lives.
 *
 * The definitions are one sentence each and written for someone who has never
 * shipped anything. "Charges that accrue when a container sits at the port too
 * long" beats the dictionary definition every time.
 */

import type { ReactNode } from 'react'

/**
 * The glossary.
 *
 * Keys are stable identifiers, not display strings, so the same term can be
 * written "demurrage" in one sentence and "Demurrage" at the head of a column
 * and still resolve to one definition.
 */
export const GLOSSARY = {
  demurrage:
    'A daily charge the shipping line adds when your container stays at the port longer than the free days allowed.',
  detention:
    'A daily charge for keeping the container itself past the agreed time, after it has left the port.',
  freeTime: 'The number of days a container can sit at the port before daily charges start.',
  incoterm:
    'The three-letter code that says who pays for which part of the journey, and where responsibility passes from seller to buyer.',
  hbl: 'House Bill of Lading — the receipt we issue to the customer for their cargo.',
  mbl: 'Master Bill of Lading — the receipt the shipping line issues to us.',
  hsCode:
    'The international code for what the goods are. Customs uses it to decide the duty payable.',
  fcl: 'Full Container Load — the customer has booked a whole container to themselves.',
  lcl: 'Less than Container Load — the cargo shares a container with other shippers.',
  eta: 'Estimated time of arrival — when the ship or aircraft is currently expected to land.',
  etd: 'Estimated time of departure — when it is currently expected to leave.',
  sla: 'The time we have promised to reply in. Passing it is what "overdue" means here.',
  clearance: 'Customs approval to release the goods, once duties and paperwork are settled.',
  manifest: 'The official list of everything on board the ship or aircraft.',
  consignee: 'The party the goods are being shipped to.',
  shipper: 'The party sending the goods.',
  margin: 'What is left of the price after the costs we pay to carriers and agents.',
  demurrageClock:
    'The running count of chargeable days on a container that has not yet been collected.',
  allocation: 'Matching a payment we have received against the invoices it settles.',
  exception: 'Anything that has gone wrong on a shipment and needs someone to act.',
  milestone: 'One step of the journey — booked, loaded, sailed, arrived, cleared, delivered.',
} as const

export type TermKey = keyof typeof GLOSSARY

/**
 * A word with its meaning attached.
 *
 * `children` is the display text and defaults to nothing, so `<Term
 * name="demurrage">Demurrage</Term>` reads naturally at a call site and the
 * key stays independent of capitalisation and language.
 */
export function Term({
  name,
  children,
  className,
}: {
  readonly name: TermKey
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <abbr
      title={GLOSSARY[name]}
      className={[
        'cursor-help underline decoration-dotted decoration-from-font underline-offset-[3px] no-underline-skip-ink',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ textDecorationLine: 'underline', textDecorationStyle: 'dotted' }}
    >
      {children}
    </abbr>
  )
}

/**
 * A plain-language note attached to a panel.
 *
 * Every card on the board carries one. It is the difference between a chart
 * someone glances at and a chart someone can act on, and it costs one line.
 */
export function Explain({ children }: { readonly children: ReactNode }) {
  return <p className="mt-1 text-[0.8125rem] leading-snug text-ink-muted">{children}</p>
}
