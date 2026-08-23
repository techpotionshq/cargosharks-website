/**
 * The public read API, served by `apps/service` and reached through this
 * container so the service needs no domain of its own. The reasoning, and
 * what is deliberately *not* forwarded, is in `@/lib/service-proxy`.
 *
 * Every method is handed over rather than only the ones the service answers
 * today: the service owns this surface, and a `DELETE` that it does not know
 * should be its 404, not a 405 invented here.
 */

import { proxyToService } from '@/lib/service-proxy'

export const GET = proxyToService
export const POST = proxyToService
export const PUT = proxyToService
export const PATCH = proxyToService
export const DELETE = proxyToService
