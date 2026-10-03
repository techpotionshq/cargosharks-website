/**
 * Who wrote a message on an enquiry's thread, and so who may be answered.
 *
 * An enquiry's `messages` are not one conversation with the customer. The
 * customer writes; the agent and the coordinators answer; and an overseas
 * agent's rate reply to our RFQ is filed on the same enquiry, buy prices and
 * all, because that is the enquiry it prices. "Reply to the customer" once took
 * the latest inbound message as the customer's and sent a coordinator's selling
 * price to the agent who had just quoted the buy (NEW-1). So every inbound row
 * is put on a side here, and only the `customer` side is ever a reply target.
 *
 * The rule leans one way on purpose. A message is the customer's only when
 * nothing says otherwise: not written by staff, not tied to a rate request, not
 * carrying an RFQ tag, and not from an address or number we know as a partner's,
 * a colleague's or our own mailbox's. Calling a customer a partner costs a
 * refusal the coordinator can read; calling a partner the customer leaks a
 * margin. A party who is both (an overseas agent on their own imports) is
 * therefore treated as the partner, and the coordinator answers them directly.
 *
 * Pure, so the service that sends and the screen that shows where a reply would
 * go read one rule, and so the rule is a millisecond test.
 */

/** Which side of the trade wrote a message. */
export type ThreadSide = 'customer' | 'partner' | 'staff' | 'agent'

/**
 * Domains nobody may be identified by.
 *
 * A customer contact at `gmail.com` must never make every other Gmail sender
 * that customer, nor may one partner on Gmail make every Gmail customer a
 * partner. The domain rule is a convenience for corporate mail and a hazard
 * everywhere else, so the shared providers are named and excluded rather than
 * being left to an "exactly one match" check, which a small deployment with one
 * Gmail-using party would pass, wrongly, on its first cold enquiry.
 */
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
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
 * The domain an address may be identified by, or null.
 *
 * Null for a shared provider, and that is the whole point of the function:
 * FR-MD-10 treats an email domain as identifying, which is true of
 * `shipper.com.kw` and catastrophic for `gmail.com`.
 */
export function identifyingDomain(address: string): string | null {
  const at = address.trim().toLowerCase().lastIndexOf('@')
  if (at < 1) return null

  const domain = address
    .trim()
    .toLowerCase()
    .slice(at + 1)
  if (!domain || !domain.includes('.')) return null

  return PUBLIC_MAIL_DOMAINS.has(domain) ? null : domain
}

/** The RFQ tag our send worker stamps into a subject. Hex, so it survives every mail client. */
const RFQ_TAG_RE = /\[RFQ:([A-Za-z0-9]{8,40})\]/

/**
 * The RFQ token a message carries, or null.
 *
 * Reads the subject first and the body second, because a broker who starts a
 * fresh mail rather than hitting reply still often pastes the subject line, and
 * a forward that mangles the subject can leave the tag only in the quoted body.
 */
export function rfqTokenIn(subject: string | null, body: string): string | null {
  const inSubject = subject ? RFQ_TAG_RE.exec(subject) : null
  if (inSubject) return inSubject[1] ?? null
  const inBody = RFQ_TAG_RE.exec(body)
  return inBody ? (inBody[1] ?? null) : null
}

/**
 * A phone number as digits only, without an international `00` or trunk `0`.
 * Null when what is left is too short to identify anyone.
 */
export function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^0-9]/g, '').replace(/^0{1,2}/, '')
  return digits.length >= 7 ? digits : null
}

/**
 * Whether two numbers are the same phone, the rule customer matching uses.
 *
 * Equal digits, or one is the other's national part with a one-to-three digit
 * country code in front: a contact typed `2220 1234` is WhatsApp's
 * `96522201234`.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = phoneDigits(a)
  const y = phoneDigits(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length < y.length ? [x, y] : [y, x]
  const extra = long.length - short.length
  return extra >= 1 && extra <= 3 && long.endsWith(short)
}

/** A party we know, by the addresses that identify them. */
export interface KnownParty {
  readonly email: string | null
  readonly phone: string | null
}

export interface KnownPartner extends KnownParty {
  readonly partnerId: string
}

/** Everyone a message on the thread could be from who is not the customer. */
export interface ThreadParties {
  readonly partners: readonly KnownPartner[]
  /** Staff of the office: their own mail or phone writing in is not the customer. */
  readonly staff: readonly KnownParty[]
  /** The office's own mailboxes and WhatsApp numbers. */
  readonly ownAddresses: readonly string[]
  /**
   * Contacts of a customer *other than* the enquiry's own. A mail from customer
   * B's contact quoting customer A's reference is filed on A's enquiry, and
   * answering it would send A's file to B.
   */
  readonly otherCustomers: readonly KnownParty[]
}

/** Whether an address is the given party's: the exact mail, its corporate domain, or the phone. */
function isParty(address: string, party: KnownParty, byDomain: boolean): boolean {
  const lower = address.trim().toLowerCase()
  if (lower.includes('@')) {
    const email = party.email?.trim().toLowerCase()
    if (!email) return false
    if (email === lower) return true
    if (!byDomain) return false
    const domain = identifyingDomain(lower)
    return domain !== null && identifyingDomain(email) === domain
  }
  return samePhone(lower, party.phone)
}

/**
 * The partner an address belongs to, or null.
 *
 * By exact address, by corporate domain (an agent's pricing desk writes from
 * `pricing@` when the contact on file is `ops@`), or by phone. The first match
 * names the partner for the label; for the reply rule any match is enough.
 */
export function partnerOfAddress(
  address: string | null | undefined,
  parties: Pick<ThreadParties, 'partners'>,
): string | null {
  if (!address?.trim()) return null
  return parties.partners.find((p) => isParty(address, p, true))?.partnerId ?? null
}

/**
 * Why an address must never receive a reply meant for the customer, or null
 * when nothing we know says it is anyone but the customer.
 */
export function notCustomerAddress(
  address: string | null | undefined,
  parties: ThreadParties,
): 'partner' | 'staff' | 'own' | 'other_customer' | 'empty' | null {
  if (!address?.trim()) return 'empty'
  const lower = address.trim().toLowerCase()
  const own = (o: string) =>
    o.trim().toLowerCase() === lower || (!lower.includes('@') && samePhone(o, lower))
  if (parties.ownAddresses.some(own)) return 'own'
  if (partnerOfAddress(address, parties)) return 'partner'
  // Staff and other customers by exact address or phone only: a colleague's
  // domain is our own, and a customer's domain may be shared by the enquirer.
  if (parties.staff.some((s) => isParty(address, s, false))) return 'staff'
  if (parties.otherCustomers.some((c) => isParty(address, c, false))) return 'other_customer'
  return null
}

/** What `threadSide` reads off one message row. */
export interface ThreadMessageFacts {
  readonly direction: 'inbound' | 'outbound'
  readonly fromAddress: string | null
  readonly subject: string | null
  readonly body: string
  readonly authorId: string | null
  readonly staffAuthored: boolean
  /** Set on supplier mail filed on no record. */
  readonly partnerId: string | null
  /** The partner whose rate request this row answered (`rate_requests.message_id`), if any. */
  readonly rateRequestPartnerId: string | null
}

export interface ThreadSideResult {
  readonly side: ThreadSide
  /** The partner, where the side is `partner` and we can say which. */
  readonly partnerId: string | null
}

/**
 * The side a message is on.
 *
 * Outbound: the agent when the system wrote it or nobody is named, staff
 * otherwise (a person in the product, or `staff_authored` from their own phone).
 * Inbound: staff when a person is named or marked; a partner when anything ties
 * it to one, a rate request, an RFQ tag (whose request `tokenPartner` resolves),
 * the supplier column, or a partner's address; staff again for a colleague or
 * our own mailbox writing in; the customer otherwise.
 */
export function threadSide(
  message: ThreadMessageFacts,
  parties: ThreadParties,
  systemPrincipalId: string,
  tokenPartner: (token: string) => string | null = () => null,
): ThreadSideResult {
  if (message.direction === 'outbound') {
    const person =
      message.authorId !== null && message.authorId !== systemPrincipalId
        ? true
        : message.staffAuthored
    return { side: person ? 'staff' : 'agent', partnerId: null }
  }
  if (message.staffAuthored) return { side: 'staff', partnerId: null }
  if (message.authorId !== null) {
    return { side: message.authorId === systemPrincipalId ? 'agent' : 'staff', partnerId: null }
  }

  const token = rfqTokenIn(message.subject, message.body)
  const tied =
    message.rateRequestPartnerId ??
    message.partnerId ??
    (token ? tokenPartner(token) : null) ??
    partnerOfAddress(message.fromAddress, parties)
  if (tied || token) return { side: 'partner', partnerId: tied }

  const not = notCustomerAddress(message.fromAddress, parties)
  if (not === 'staff' || not === 'own') return { side: 'staff', partnerId: null }
  return { side: 'customer', partnerId: null }
}
