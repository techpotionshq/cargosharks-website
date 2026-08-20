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
 * Domains nobody may be identified by.
 *
 * A customer contact at `gmail.com` must never make every other Gmail sender
 * that customer. The domain rule below is a convenience for corporate mail and
 * a hazard everywhere else, so the shared providers are named and excluded
 * rather than being left to the "exactly one customer" check — which a small
 * deployment with one Gmail-using customer would pass, wrongly, on its first
 * cold enquiry.
 */
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'yandex.com',
  'qq.com',
  '163.com',
])

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

/**
 * The domain an address may be identified by, or null.
 *
 * Null for a shared provider, and that is the whole point of the function:
 * FR-MD-10 treats an email domain as identifying, which is true of
 * `shipper.com.kw` and catastrophic for `gmail.com` — one customer contact
 * with a Gmail address would otherwise make every cold enquiry from any Gmail
 * user that customer's, complete with their rates.
 */
export function identifyingDomain(address: string): string | null {
  const at = address.trim().toLowerCase().lastIndexOf('@')
  if (at < 1) return null

  const domain = address.trim().toLowerCase().slice(at + 1)
  if (!domain || !domain.includes('.')) return null

  return PUBLIC_MAIL_DOMAINS.has(domain) ? null : domain
}

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
