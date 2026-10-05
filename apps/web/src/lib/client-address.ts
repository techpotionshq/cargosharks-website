/**
 * The caller's address, read from `X-Forwarded-For` the way the deployment
 * actually writes it — A15.
 *
 * ## Why not the leftmost entry
 *
 * Every proxy *appends* the address it received the connection from. So the
 * header is a list written left to right by whoever touched the request, and
 * only the entries added by proxies we run can be believed: anything to their
 * left arrived in the request, and the client typed it. Reading the leftmost
 * entry — which is what this used to do in three places — let anyone send
 * `X-Forwarded-For: 1.2.3.4` and be counted as 1.2.3.4, so the sign-in throttle
 * could be dodged by changing a header on every request, and the audit trail
 * recorded whatever the caller liked.
 *
 * ## How many to trust
 *
 * `TRUSTED_PROXY_HOPS`: the number of proxies in front of this process that
 * append to the header. The client is the entry that many places from the
 * right. The default is 1, which is the shipped topology — Traefik in front of
 * the web container (`compose.prod.yaml`). A deployment behind a CDN *and* a
 * load balancer sets 2; one exposed with no proxy at all sets 0, and then the
 * header is ignored entirely, because with nobody in front every entry in it
 * is the caller's own invention.
 *
 * When the header has fewer entries than there are trusted hops the request
 * did not come through all of them, and there is no entry we wrote. That
 * reads as no address rather than as the leftmost one: the throttle fails
 * open to the account lock behind it (`lib/throttle.ts`), and a wrong address
 * is worse than none in an audit row.
 *
 * The service reads the same variable for Fastify's `trustProxy`, so one
 * setting describes the deployment to both processes.
 *
 * ## Handing it to Better Auth
 *
 * Better Auth resolves its own address — for its rate limiter and the
 * `ip_address` on a session row — from a list of headers, and takes no
 * computed value. Left to `X-Forwarded-For` it either trusts a single entry
 * or, given the two Traefik writes when a caller sends one, resolves nothing
 * and throttles every caller in one shared bucket. So `proxy.ts` writes the
 * address computed here into `CLIENT_ADDRESS_HEADER` on every request,
 * overwriting whatever the caller sent under that name, and `auth.ts` tells
 * Better Auth to read only that header. One rule, one place, both consumers.
 */

/**
 * Set by `proxy.ts` from `clientAddressFrom`, and the only header Better Auth
 * reads an address from. Never trusted from outside: the proxy replaces it on
 * every request, or removes it where no address can be believed.
 */
export const CLIENT_ADDRESS_HEADER = 'x-qabandi-client-address'

/** Better Auth's `advanced.ipAddress`: that header and nothing else. */
export const BETTER_AUTH_IP_ADDRESS = { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] }

/** Read once per call rather than at import, so a test can change it. */
export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS
  if (raw === undefined || raw.trim() === '') return 1
  const hops = Number(raw)
  return Number.isInteger(hops) && hops >= 0 ? hops : 1
}

/** The client's address from a forwarded-for value, or null when none can be believed. */
export function addressFromForwardedFor(
  header: string | null | undefined,
  hops = trustedProxyHops(),
): string | null {
  if (!header || hops === 0) return null
  const entries = header
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (entries.length < hops) return null
  return entries[entries.length - hops] ?? null
}

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/).
 *
 * The test that a connection came *from* Cloudflare, which is the only thing
 * that makes `CF-Connecting-IP` worth reading — see `clientAddressFrom`. The
 * list changes perhaps once a year; `CLOUDFLARE_IP_RANGES` (comma-separated
 * CIDRs) replaces it without a release when it does. A range missing here
 * fails safe: that edge's visitors are counted under the edge's address, as
 * every visitor was before this existed, and nobody can forge their way in.
 */
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]

/** Read once per call, like `trustedProxyHops`, so a test can change it. */
function cloudflareRanges(): readonly string[] {
  const raw = process.env.CLOUDFLARE_IP_RANGES
  if (!raw || raw.trim() === '') return CLOUDFLARE_RANGES
  return raw
    .split(',')
    .map((range) => range.trim())
    .filter(Boolean)
}

/** An address as a bigint and its width, or null for anything that is not one. */
function parseAddress(value: string): { bits: bigint; width: 32 | 128 } | null {
  const text = value.trim()
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (v4) {
    const octets = v4.slice(1).map(Number)
    if (octets.some((octet) => octet > 255)) return null
    return { bits: octets.reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n), width: 32 }
  }
  if (!text.includes(':') || !/^[0-9a-fA-F:]+$/.test(text)) return null
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (groups.some((group) => group.length === 0 || group.length > 4)) return null
  return {
    bits: groups.reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n),
    width: 128,
  }
}

/** Whether `address` falls inside one of `ranges`. Malformed ranges match nothing. */
export function addressInRanges(address: string, ranges: readonly string[]): boolean {
  const parsed = parseAddress(address)
  if (!parsed) return false
  return ranges.some((range) => {
    const [base, prefixText] = range.split('/')
    const network = base ? parseAddress(base) : null
    const prefix = Number(prefixText)
    if (!network || network.width !== parsed.width) return false
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsed.width) return false
    const shift = BigInt(parsed.width - prefix)
    return parsed.bits >> shift === network.bits >> shift
  })
}

/**
 * The caller's address, from anything with a `get` — `Headers`, or Next's
 * `headers()`.
 *
 * ## `CF-Connecting-IP`, and why it is not simply read
 *
 * Production sits behind Cloudflare. Cloudflare connects to our proxy, so the
 * trusted-hop entry above is a Cloudflare edge address, and every person in
 * the company used to share one sign-in budget with everybody else on that
 * edge (run 5, R11). Cloudflare writes the visitor's real address into
 * `CF-Connecting-IP`, overwriting any value the visitor sent.
 *
 * But that overwrite only happens on requests that pass through Cloudflare.
 * If the origin can be reached directly — a leaked origin address, a missing
 * firewall rule — the header arrives exactly as the caller typed it, and
 * believing it would hand every caller a fresh budget per request and a
 * forged address in the audit trail. So the rule is:
 *
 *   The header is read only when the entry our own proxy recorded — the
 *   address that actually opened the connection to us — is inside
 *   Cloudflare's published ranges. Only then did Cloudflare send the request,
 *   and only then did Cloudflare write the header.
 *
 * Anything else — no trusted hop (`TRUSTED_PROXY_HOPS=0`), a peer outside the
 * ranges, a header that is not an address — falls back to the trusted-hop
 * entry, which is what a direct caller cannot forge. And if the operator later
 * sets `TRUSTED_PROXY_HOPS=2` to count Cloudflare as a hop, the trusted entry
 * is already the visitor (Cloudflare appends to `X-Forwarded-For` too), it is
 * not a Cloudflare address, and the header is simply not needed. Both settings
 * give the same answer, which is the point: the number can be fixed later
 * without the sign-in throttle changing behaviour on the day.
 */
export function clientAddressFrom(headers: { get(name: string): string | null }): string | null {
  const peer = addressFromForwardedFor(headers.get('x-forwarded-for'))
  if (!peer || !addressInRanges(peer, cloudflareRanges())) return peer
  const visitor = headers.get('cf-connecting-ip')?.trim()
  return visitor && parseAddress(visitor) ? visitor : peer
}
