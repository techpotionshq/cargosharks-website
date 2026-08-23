/**
 * Carrier and provider callbacks — WhatsApp, inbound mail — served by
 * `apps/service` and reached through this container so the service needs no
 * domain of its own. Providers are configured with this application's domain:
 * `https://<web>/webhooks/email`, `https://<web>/webhooks/whatsapp`.
 *
 * The body crosses unchanged, byte for byte — both handlers verify an HMAC
 * over exactly what the provider signed. See `@/lib/service-proxy`.
 */

import { proxyToService } from '@/lib/service-proxy'

export const GET = proxyToService
export const POST = proxyToService
export const PUT = proxyToService
export const PATCH = proxyToService
export const DELETE = proxyToService
