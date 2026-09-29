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

/** The token as it appears in a subject. Hex, so it survives every mail client. */
const RFQ_TAG_RE = /\[RFQ:([A-Za-z0-9]{8,40})\]/

/** A fresh RFQ token — hex, matched by `RFQ_TAG_RE`. The web action has its own. */
export function newRfqToken(): string {
  return randomBytes(12).toString('hex')
}

/** The tag to stamp into an outbound RFQ subject. */
export function rfqSubjectTag(token: string): string {
  return `[RFQ:${token}]`
}

/**
 * The RFQ token a reply carries, or null.
 *
 * Reads the subject first and the body second, because a broker who starts a
 * fresh mail rather than hitting reply still often pastes the subject line — and
 * a forward that mangles the subject can leave the tag only in the quoted body.
 */
export function rfqTokenIn(subject: string | null, body: string): string | null {
  const inSubject = subject ? RFQ_TAG_RE.exec(subject) : null
  if (inSubject) return inSubject[1] ?? null
  const inBody = RFQ_TAG_RE.exec(body)
  return inBody ? (inBody[1] ?? null) : null
}
