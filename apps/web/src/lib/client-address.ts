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

/** The same, from anything with a `get` — `Headers`, or Next's `headers()`. */
export function clientAddressFrom(headers: { get(name: string): string | null }): string | null {
  return addressFromForwardedFor(headers.get('x-forwarded-for'))
}
