import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { proxyToService } from './service-proxy'

const fetchMock = vi.fn()

function upstream(body = '{}', init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('SERVICE_URL', 'http://service.test:3001/')
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('proxyToService', () => {
  it('forwards method, path and query to the service, and nothing else about the address', async () => {
    fetchMock.mockResolvedValue(upstream())

    await proxyToService(new Request('https://app.example.com/api/v1/jobs?limit=5&after=x'))

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://service.test:3001/api/v1/jobs?limit=5&after=x')
    expect(init.method).toBe('GET')
    expect(init.redirect).toBe('manual')
    expect(init.cache).toBe('no-store')
  })

  /**
   * The whole reason the body is buffered rather than parsed: both webhook
   * handlers verify an HMAC over the exact bytes the provider signed, and a
   * body that came through a JSON round-trip would fail on every delivery.
   */
  it('forwards the body byte for byte, with the signature headers the service verifies', async () => {
    fetchMock.mockResolvedValue(upstream('{"accepted":true}', { status: 202 }))
    const raw = '{"id": "evt_1",   "deep": {"ws":  "  kept  "}}\n'

    const response = await proxyToService(
      new Request('https://app.example.com/webhooks/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'abc123',
          'x-hub-signature-256': 'sha256=def456',
          authorization: 'Bearer key.secret',
        },
        body: raw,
      }),
    )

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://service.test:3001/webhooks/email')
    expect(init.method).toBe('POST')
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(raw)

    const sent = init.headers as Headers
    expect(sent.get('x-webhook-signature')).toBe('abc123')
    expect(sent.get('x-hub-signature-256')).toBe('sha256=def456')
    expect(sent.get('authorization')).toBe('Bearer key.secret')
    expect(sent.get('content-type')).toBe('application/json')

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
  })

  it('keeps the forwarding headers Traefik set, so the service sees the real caller', async () => {
    fetchMock.mockResolvedValue(upstream())

    await proxyToService(
      new Request('https://app.example.com/api/v1/jobs', {
        headers: {
          'x-forwarded-for': '203.0.113.7',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'app.example.com',
          host: 'app.example.com',
        },
      }),
    )

    const sent = fetchMock.mock.calls[0]![1].headers as Headers
    expect(sent.get('x-forwarded-for')).toBe('203.0.113.7')
    expect(sent.get('x-forwarded-proto')).toBe('https')
    expect(sent.get('x-forwarded-host')).toBe('app.example.com')
    // Hop headers describe this hop, not the request.
    expect(sent.get('host')).toBeNull()
    expect(sent.get('content-length')).toBeNull()
  })

  /**
   * The property the whole arrangement rests on. The service has no public
   * domain, so the only way from outside to `/internal` would be through
   * here — and there is no route here that leads to it.
   */
  it.each([
    '/internal/documents/invoice/whatever',
    '/internal',
    '/health',
    '/api/v10/jobs',
    '/api/v1x',
    '/webhooksx/email',
    '/',
  ])('refuses %s with a 404 and never reaches the service', async (path) => {
    const response = await proxyToService(
      new Request(`https://app.example.com${path}`, {
        method: 'POST',
        headers: { 'x-internal-secret': 'leaked' },
        body: '{}',
      }),
    )

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 503 with the missing variable named when SERVICE_URL is unset', async () => {
    vi.stubEnv('SERVICE_URL', '')

    const response = await proxyToService(new Request('https://app.example.com/api/v1/jobs'))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'service_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 502 when the service cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const response = await proxyToService(new Request('https://app.example.com/api/v1/jobs'))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'service_unavailable' })
  })

  /**
   * Node's fetch inflates the body and leaves `content-encoding` on the
   * headers. Passing that on tells the browser to inflate plain JSON.
   */
  it('passes the upstream status and headers back, minus the ones the restream makes untrue', async () => {
    fetchMock.mockResolvedValue(
      upstream('{"error":"unauthorized"}', {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-remaining': '119',
          'content-encoding': 'gzip',
          'content-length': '999',
        },
      }),
    )

    const response = await proxyToService(new Request('https://app.example.com/api/v1/jobs'))

    expect(response.status).toBe(401)
    expect(response.headers.get('x-ratelimit-remaining')).toBe('119')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })
})
