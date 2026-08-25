/**
 * Response headers — the ones a browser enforces on our behalf.
 *
 * This file did not exist, and its absence was the most visible finding on the
 * build: no content-security policy, no HSTS, no frame-options, no referrer
 * policy. `apps/service` has registered `@fastify/helmet` since it was written;
 * the application holding the commercial data had nothing, which is the wrong
 * way round. The privacy notice and the DPA both said so in writing
 * (`apps/landing/src/content/pages/privacy.tsx`, §13) — this is what closes it.
 *
 * ## Why here rather than `headers()` in `next.config.ts`
 *
 * Static headers cannot carry a nonce, and a script policy without one is
 * theatre: `script-src 'self' 'unsafe-inline'` permits exactly the injected
 * script an attacker needs, so it satisfies a scanner and stops nothing. A
 * per-request nonce is the only form of `script-src` worth the line it
 * occupies, and a nonce has to be minted per request.
 *
 * `proxy.ts`, not `middleware.ts`. Next 16 renamed the convention and
 * deprecated the old name — see the note at the head of Next's own
 * `docs/01-app/03-api-reference/03-file-conventions/middleware.md`. Same
 * function, same `config` object, new export name.
 *
 * Next reads the nonce back out of the `Content-Security-Policy` header set on
 * the *request* and stamps it onto every script tag it emits, chunk loaders
 * included. `'strict-dynamic'` then extends that trust to the chunks those
 * scripts pull in — without it webpack's runtime imports are blocked and the
 * application does not hydrate at all.
 *
 * The cost is that a page carrying a nonce renders dynamically. Here that is
 * already true of all of them: every screen reads the session, and the nine
 * route handlers are `force-dynamic` in their own right.
 *
 * ## What each external origin is doing in the policy
 *
 * Four, and no more. Each was found by reading the source rather than by
 * loosening the policy until the page rendered:
 *
 *   fonts.googleapis.com   the stylesheet in `app/layout.tsx`, loaded as a
 *                          link rather than through `next/font` so a build
 *                          never needs the network (Pilot §4)
 *   fonts.gstatic.com      the font files that stylesheet then asks for
 *   tiles.openfreemap.org  vector tiles and glyphs for `ui/lane-map.tsx`
 *   blob:                  maplibre-gl runs its renderer in a worker it builds
 *                          from a blob, so `worker-src` must admit it or every
 *                          map is a blank rectangle
 *
 * A fifth belongs here in the same breath as the code that reaches for it. A
 * policy amended weeks later by whoever is debugging a blank panel is a policy
 * that ends up as `*`.
 */

import { NextResponse, type NextRequest } from 'next/server'

const PRODUCTION = process.env.NODE_ENV === 'production'

export function proxy(request: NextRequest) {
  const nonce = newNonce()

  /*
    `style-src` keeps `'unsafe-inline'` and `script-src` does not, and the
    asymmetry is deliberate rather than a compromise half-made.

    A nonce and `'unsafe-inline'` cannot coexist: CSP3 says a browser that
    understands nonces ignores `'unsafe-inline'` in the same directive. Next's
    own documented example nonces styles too, and it cannot work here — because
    a nonce applies to `<style>` *elements* and does nothing for style
    *attributes*, which are governed by `'unsafe-inline'` alone.

    This application is full of them. Every React `style={{…}}` prop compiles
    to one, and maplibre-gl positions every marker and control by assigning
    `element.style` directly. Nonce-only styling would leave the map a heap of
    unpositioned divs and would do it at runtime, on one screen, long after the
    build went green.

    So the exchange is taken for scripts, where the outcome is code execution,
    and declined for styles, where it is not.
  */
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${PRODUCTION ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "connect-src 'self' https://tiles.openfreemap.org",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    // Belt and braces with `X-Frame-Options` below. `frame-ancestors` is the
    // one modern browsers honour; the header is for whatever is still running
    // in a freight office.
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    // Only where there is TLS to upgrade to. On a laptop this rewrites every
    // `http://localhost` request to `https://` and breaks `pnpm dev`.
    ...(PRODUCTION ? ['upgrade-insecure-requests'] : []),
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', policy)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  response.headers.set('Content-Security-Policy', policy)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  /*
    Proof of delivery is why two of these are `self` rather than empty.

    `features/pod/ui/capture.tsx` calls `navigator.geolocation` to stamp where
    a delivery was signed for, and its file input carries `capture="environment"`
    to open the rear camera directly. NFR-13 says this works in a mobile browser
    with no app install, so a blanket `camera=(), geolocation=()` would break
    the one screen used outdoors, on a phone, by a driver — and would break it
    silently, months after this file was written.

    Everything else is denied, including interfaces nothing here has ever asked
    for. That is the point of the header: it states what this application will
    never need.
  */
  response.headers.set(
    'Permissions-Policy',
    [
      'camera=(self)',
      'geolocation=(self)',
      'microphone=()',
      'payment=()',
      'usb=()',
      'serial=()',
      'bluetooth=()',
      'midi=()',
      'accelerometer=()',
      'gyroscope=()',
      'magnetometer=()',
      'display-capture=()',
      'browsing-topics=()',
    ].join(', '),
  )

  /*
    Cross-origin isolation, at the strength the product can actually carry.

    `same-origin` on the opener policy costs nothing: nothing here opens a
    window it then talks to. The resource policy is deliberately `same-site`
    rather than `same-origin` — a whitelabel deployment serves the application
    and the operator's marketing site from two hosts under one registrable
    domain, and `same-origin` would stop the latter loading anything from the
    former.
  */
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-site')

  if (PRODUCTION) {
    /*
      Two years, subdomains included, and **not** `preload`.

      The omission is the considered part. Preloading is a submission to a list
      compiled into the browser itself: it takes months to reverse and it
      applies to the whole registrable domain, including hosts nobody in this
      repository controls. This product is whitelabel and is deployed on the
      *customer's* domain — committing their mail host or their old marketing
      site to HTTPS-only, on their behalf, from a header in our middleware, is
      not a decision this file gets to make.

      An operator who wants it says so, changes one word, and accepts what it
      means. `docs/compliance/Security_Measures.md` records it as an open
      choice rather than a gap.
    */
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  }

  return response
}

export const config = {
  /*
    Everything except the things a policy cannot help.

    `_next/static` and `_next/image` are immutable build output served straight
    from disk; running middleware over them would mint a nonce per chunk
    request and buy nothing. The rest are files fetched by machines that send
    no cookies and parse no CSP — including `.well-known`, where `security.txt`
    lives, and a disclosure address a researcher cannot read is not one.
  */
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|\\.well-known).*)',
  ],
}

/**
 * 128 bits from the platform CSPRNG, base64.
 *
 * `Math.random()` is the tempting one-liner here and it would void the whole
 * policy: a predictable nonce is a nonce an injected script can simply carry.
 * `crypto` is a global in both the edge and Node runtimes, so this needs no
 * import and no runtime pin.
 */
function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}
