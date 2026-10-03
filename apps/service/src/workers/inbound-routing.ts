/**
 * The attribution rules — pure, and deliberately in their own file.
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * These are the decisions most likely to be wrong and least likely to announce
 * it: a pattern loose enough to catch a container number threads a customer's
 * mail onto a stranger's shipment, and a domain rule that trusts `gmail.com`
 * hands one customer's rates to anyone with a Google account. Neither throws.
 * Both want tests that run in a millisecond against nothing at all.
 *
 * And `inbound-mail.ts` imports `@qabandi/db` and `../config`, both of which
 * read the environment as they load. A test file that imported the rules from
 * there would — because ES imports are hoisted and evaluated before any
 * statement in the importing module — parse the configuration before it had a
 * chance to set any, which is a failure that looks like a broken worker rather
 * than a broken import. This file imports nothing, so nothing can happen to it.
 */

/**
 * Our own references, as they appear in a subject line.
 *
 * `KWI-ENQ-2026-00042`, `FXH-JOB-2026-00001` — branch code, series, year,
 * five digits. This is the primary attribution path and it is not a fallback:
 * forwarding desks quote the reference back because that is how the trade
 * works, and it is the only signal in an email that we issued ourselves.
 */
const REFERENCE_RE = /\b([A-Z]{2,5})-(ENQ|JOB)-(\d{4})-(\d{5})\b/g

/**
 * Every reference this mail quotes, in the order it quotes them.
 *
 * Pure, and exported, because it is the decision most likely to be wrong and
 * the one that cannot be exercised without it: attributing a customer's mail
 * to the wrong shipment is the failure this file most needs to avoid, and
 * proving the pattern does not match a container number or a date needs no
 * database at all.
 *
 * Order is preserved and duplicates removed, so a `Re:` chain quoting the same
 * reference four times is tried once, and a mail naming an enquiry *and* a job
 * resolves in the order the sender wrote them.
 */
export function referencesIn(subject: string, body: string): string[] {
  return dedupe([...`${subject}\n${body}`.matchAll(REFERENCE_RE)].map((m) => m[0]))
}

/*
  The domain rule moved to `@qabandi/core` (`thread-sides.ts`) once the reply
  rule needed it too: which partner an address belongs to is the same question
  as which customer, and two copies of the shared-provider list would drift.
*/
export { identifyingDomain } from '@qabandi/core'

/**
 * Where an inbound attachment lives in the bucket.
 *
 * Keyed by branch, year and message so an operator with bucket access can find
 * a customer's documents without joining anything — the same reasoning as
 * `storageKeyFor` in `pdf/store.ts`. The filename is sanitised on the way in:
 * it is the sender's, and a sender may call a file `../../etc/passwd`.
 */
export function inboundStorageKey(
  branchCode: string,
  receivedAt: Date,
  externalId: string,
  filename: string,
  index: number,
): string {
  /*
    Dots are collapsed as well as separators replaced, and both are needed.

    Replacing the path separators alone leaves `../../etc/passwd` as
    `..-..-etc-passwd`: harmless in a key that no longer contains a slash, but
    only by accident, and a storage layer that normalises `..` — or a future
    driver that writes to a filesystem — turns that accident into a traversal.
    The dot has to survive for `invoice.pdf`, so runs of them collapse to one
    rather than being stripped.
  */
  const safe = (s: string): string =>
    s
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .replace(/\.{2,}/g, '.')
      .slice(0, 100)
  const thread = safe(externalId.replace(/[<>]/g, ''))
  return `inbound/${safe(branchCode)}/${receivedAt.getUTCFullYear()}/${thread}/${index}-${safe(filename)}`
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/* -------------------------------------------------------------------------
   Mail that a machine sent
   ------------------------------------------------------------------------- */

/**
 * Senders that are a mail system talking, not a person.
 *
 * `MAILER-DAEMON` and `postmaster` are the two every MTA uses; the rest are
 * the auto-responder conventions of the large providers. Matched on the local
 * part only, case-insensitively, because the domain is whichever server
 * bounced it.
 */
const DAEMON_LOCAL_PARTS = new Set([
  'mailer-daemon',
  'postmaster',
  'mail-daemon',
  'maildaemon',
  'bounce',
  'bounces',
  'auto-reply',
  'autoreply',
  'noreply-dmarc-support',
])

/**
 * Subjects that are a delivery report or an auto-reply in any common MTA's
 * wording. Anchored loosely on purpose — Exchange, Postfix, Gmail and Exim all
 * phrase these differently, and a bounce that slipped past here costs one
 * junk enquiry, while a real enquiry refused here costs a customer. So the
 * list is the phrasings that are never a person asking for a rate.
 */
const AUTOMATIC_SUBJECTS: readonly RegExp[] = [
  /^undeliverable\b/i,
  /undelivered mail returned to sender/i,
  /delivery status notification/i,
  /^delivery (has )?failed/i,
  /mail delivery (failed|failure|subsystem)/i,
  /failure notice/i,
  /returned mail/i,
  /^(automatic|auto(matic)?[- ]?reply|autoreply)\b/i,
  /^out of (the )?office\b/i,
  /^read:/i,
  /^(accepted|declined|tentative):/i,
]

/**
 * Is this mail from a machine rather than a person?
 *
 * Three signals, any one sufficient:
 *
 *   1. the adapter said so, from headers only it can see — `automatic`;
 *   2. the sender is a mail daemon by name;
 *   3. the subject is a delivery report or an auto-reply.
 *
 * Pure, and kept beside the other attribution rules because it is one: it
 * decides whether a message is *about* anything at all. The failure it
 * prevents is a loop — a bounce filed as an enquiry notifies the daemon that
 * bounced it, which bounces again, which files again — and a loop is not a
 * thing a retry policy or an SLA clock can see from inside. Every turn of it
 * looked, to every other rule in this system, like a new customer.
 *
 * What this must not become is a spam filter. A message from an unknown
 * person with an odd subject is an enquiry; that is the whole point of
 * FR-EQ-02. Only mail that *declares itself* automatic, by header, by sender
 * name, or by a phrasing no person writes to ask for a quote, is refused.
 */
export function isAutomaticMail(message: {
  readonly from: string
  readonly subject: string
  readonly automatic?: boolean
}): boolean {
  if (message.automatic) return true

  const local = message.from.trim().toLowerCase().split('@')[0] ?? ''
  if (DAEMON_LOCAL_PARTS.has(local)) return true

  const subject = message.subject.trim()
  return AUTOMATIC_SUBJECTS.some((pattern) => pattern.test(subject))
}
