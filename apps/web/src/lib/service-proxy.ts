/**
 * The service's public surface, reached through this container.
 *
 * ## Why the web app fronts the service at all
 *
 * The service has two prefixes that the outside world must reach — `/webhooks`
 * takes the WhatsApp and mail callbacks, `/api/v1` is the customer read API —
 * and one, `/internal`, that must never be reachable from outside: it
 * authenticates the caller with a shared secret and then lets that caller name
 * the principal to act as. Giving the service its own domain to serve the first
 * two put the third one hop behind a proxy rule, with a header check in
 * `apps/service/src/api/internal.ts` as the thing standing between a leaked
 * secret and every branch's data.
 *
 * Routed through here instead, the service has **no public domain**. The two
 * public prefixes are the only paths this module will forward, so `/internal`
 * is unreachable from outside not because a guard refused it but because no
 * route leads there. One domain, one Traefik router, nothing to get wrong in a
 * deployment UI.
 *
 * ## Why a route handler rather than `rewrites()` in `next.config.ts`
 *
 * Rewrites are resolved at build time and written into the routes manifest, so
 * an external destination would bake whatever `SERVICE_URL` was when the image
 * was built — which, in the Dockerfile, is nothing. This reads the variable per
 * request, the same way every other handler here reaches the service, and a
 * change to it needs a restart rather than a rebuild.
 *
 * ## What is forwarded, byte for byte
 *
 * The body is buffered and sent unchanged. Both webhook handlers verify an HMAC
 * over the exact bytes the provider signed, and a body that has been parsed and
 * re-serialised on the way through would fail that check on every delivery.
 * The forwarding headers Traefik set are passed along as they arrived, so the
 * service's rate limiter and audit trail see the caller's address rather than
 * this container's.
 */

import 'server-only'

/**
 * Everything else the service serves is answered with *not found* rather than
 * forwarded — `/internal` in particular, and `/health`, which is the
 * platform's probe of the service container and not a public endpoint.
 */
const PUBLIC_PREFIXES = ['/api/v1', '/webhooks'] as const

/**
 * Headers that describe the hop rather than the request. `host` would make the
 * service answer for a name it does not hold; `content-length` is recomputed
 * from the body actually sent; the rest are hop-by-hop by specification.
 */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'content-length',
])

/**
 * Response headers that stop being true once the body has been read by
 * `fetch` and re-streamed here. `content-encoding` is the sharp one: Node's
 * fetch decompresses the body but leaves the header in place, and a browser
 * that believes it would try to inflate plain JSON.
 */
const NOT_RESTREAMED = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
])

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export async function proxyToService(request: Request): Promise<Response> {
  const incoming = new URL(request.url)

  // 404 rather than 403, on the same reasoning as `/internal` itself: a path
  // that answers "forbidden" has confirmed it exists and is worth attacking.
  if (!isPublic(incoming.pathname)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const base = process.env.SERVICE_URL
  if (!base) {
    // The record of what was asked is not lost — a provider that gets a 503
    // redelivers — but saying what is missing is more useful than a 500.
    return Response.json(
      {
        error: 'service_not_configured',
        message: 'This path is served by the service. Set SERVICE_URL to reach it.',
      },
      { status: 503 },
    )
  }

  const target = `${base.replace(/\/$/, '')}${incoming.pathname}${incoming.search}`

  const headers = new Headers()
  request.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name)) headers.set(name, value)
  })

  // GET and HEAD carry no body by specification; `fetch` throws if given one.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const body = hasBody ? await request.arrayBuffer() : undefined

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      // A 3xx from the service is the service's answer; following it here
      // would hand the caller the body of wherever it pointed instead.
      redirect: 'manual',
      cache: 'no-store',
    })
  } catch {
    return Response.json({ error: 'service_unavailable' }, { status: 502 })
  }

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, name) => {
    if (!NOT_RESTREAMED.has(name)) responseHeaders.set(name, value)
  })

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}
