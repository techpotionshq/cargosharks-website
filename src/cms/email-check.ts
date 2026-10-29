import { resolve4, resolveMx } from 'node:dns/promises'

/**
 * Whether a demo request's email address is worth a lead, checked before the
 * row is saved (`src/app/contact/route.ts`).
 *
 * Three answers, because they are handled differently:
 *
 *   - `disposable`: a throwaway inbox. Refused, with a message: nobody
 *     answering a sales enquiry gives one.
 *   - `undeliverable`: the domain cannot receive mail (no MX and no A record,
 *     or a "null MX", RFC 7505, as the reserved test domains publish). Usually
 *     a typo, so the visitor is told and can fix it.
 *   - `ok`, with `personal` set for the big free providers. Kept: plenty of
 *     small forwarders run on Gmail. Slack says so, so nobody is surprised.
 *
 * DNS that cannot be reached is not the visitor's fault, so a lookup that
 * times out or errors in any other way lets the address through.
 */
export type EmailVerdict =
  { ok: true; personal: boolean } | { ok: false; reason: 'disposable' | 'undeliverable' }

/**
 * The common throwaway-inbox services. Not exhaustive (the full lists run to
 * thousands and churn weekly); these are the ones form spam actually uses.
 */
export const DISPOSABLE = new Set([
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonaddy.me',
  'burnermail.io',
  'byom.de',
  'mail-temp.com',
  'disposablemail.com',
  'dispostable.com',
  'dropmail.me',
  'emailondeck.com',
  'emailfake.com',
  'fakeinbox.com',
  'fakemail.net',
  'getairmail.com',
  'getnada.com',
  'nada.email',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamail.biz',
  'guerrillamail.de',
  'guerrillamailblock.com',
  'grr.la',
  'sharklasers.com',
  'spam4.me',
  'pokemail.net',
  'inboxkitten.com',
  'jetable.org',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailinator2.com',
  'mailnesia.com',
  'mailpoof.com',
  'mailsac.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'mytrashmail.com',
  'nowmymail.com',
  'owlymail.com',
  'spambog.com',
  'spamgourmet.com',
  'spamex.com',
  'tempail.com',
  'tempinbox.com',
  'tempmail.com',
  'tempmail.net',
  'tempmail.dev',
  'temp-mail.org',
  'temp-mail.io',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trash-mail.com',
  'trashmail.com',
  'trashmail.de',
  'trashmail.net',
  'trbvm.com',
  'wegwerfmail.de',
  'yopmail.com',
  'yopmail.net',
  'yopmail.fr',
  'cool.fr.nf',
  'jetable.fr.nf',
  'courriel.fr.nf',
  'mvrht.net',
  'harakirimail.com',
  'mailnull.com',
  'discard.email',
  'discardmail.com',
  'emltmp.com',
  'tmpmail.org',
  'tmpmail.net',
  'tmail.ws',
  'minuteinbox.com',
  'luxusmail.org',
  'smailpro.com',
  'tempmailaddress.com',
  'fakemailgenerator.com',
  'armyspy.com',
  'cuvox.de',
  'dayrep.com',
  'einrot.com',
  'fleckens.hu',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
  'mailforspam.com',
  'spamfree24.org',
  'incognitomail.org',
  'linshiyouxiang.net',
])

/** Free mailbox providers: allowed, and marked as personal. */
const PERSONAL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
])

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])

/** The domain's mail answer: true can receive, false cannot, null unknown. */
async function receivesMail(domain: string): Promise<boolean | null> {
  try {
    const mx = await withTimeout(resolveMx(domain), 4000)
    if (mx.length) return !mx.every((record) => record.exchange === '' || record.exchange === '.')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENODATA' && code !== 'ENOTFOUND') return null
    if (code === 'ENOTFOUND') return false
  }
  // No MX: mail falls back to the address record (RFC 5321 §5.1).
  try {
    return (await withTimeout(resolve4(domain), 4000)).length > 0
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENODATA' || code === 'ENOTFOUND' ? false : null
  }
}

export async function checkEmail(email: string): Promise<EmailVerdict> {
  const domain = email.split('@').pop()!.toLowerCase()
  const isOrUnder = (set: Set<string>) =>
    set.has(domain) || [...set].some((d) => domain.endsWith(`.${d}`))
  if (isOrUnder(DISPOSABLE)) return { ok: false, reason: 'disposable' }
  // Reserved for documentation and testing (RFC 2606, 6761): never a real
  // inbox. Decided here rather than by DNS, which does not always return the
  // null MX example.com publishes.
  if (/(?:^|\.)example\.(?:com|org|net)$|\.(?:test|example|invalid|localhost)$/.test(domain))
    return { ok: false, reason: 'undeliverable' }
  if (PERSONAL.has(domain)) return { ok: true, personal: true }
  if ((await receivesMail(domain)) === false) return { ok: false, reason: 'undeliverable' }
  return { ok: true, personal: false }
}
