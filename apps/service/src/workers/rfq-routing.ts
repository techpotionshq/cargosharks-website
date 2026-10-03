/**
 * The handle that ties a broker's reply back to the request it answers — FR-RT-10.
 *
 * A rate request carries an opaque `token`. The send worker stamps it into the
 * subject as `[RFQ:<token>]`; a broker replies keeping the subject; the inbound
 * mail worker reads it back here. This is deliberately *not* the enquiry
 * reference `referencesIn()` parses — one enquiry can be sent to five agents and
 * asked twice, so the enquiry reference cannot say *which* request a reply
 * answers, and the token can.
 *
 * Kept in one small pure module so the two sides — the subject we write and the
 * subject we read — cannot drift, and so the parser is a millisecond unit test.
 */

import { randomBytes } from 'node:crypto'

/*
  The reading half lives in `@qabandi/core` (`thread-sides.ts`), because the
  enquiry thread needs it too: a mail carrying our RFQ tag is a partner's, and
  must never be taken for the customer's when a coordinator replies.
*/
export { rfqTokenIn } from '@qabandi/core'

/** A fresh RFQ token — hex, matched by `rfqTokenIn`. The web action has its own. */
export function newRfqToken(): string {
  return randomBytes(12).toString('hex')
}

/** The tag to stamp into an outbound RFQ subject. */
export function rfqSubjectTag(token: string): string {
  return `[RFQ:${token}]`
}
