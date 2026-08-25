import 'server-only'

/**
 * Carrying Better Auth's cookies onto a Next navigation.
 *
 * Its own module rather than a helper inside `actions.ts`, because that file
 * carries `'use server'` and every export from a server-action module must be
 * an async function that is safe to expose as an endpoint. This is neither. It
 * moved here the moment `two-factor.ts` needed the same thing, which is the
 * point at which a copy would otherwise have been made and the two would have
 * drifted.
 */

import type { cookies } from 'next/headers'

type CookieStore = Awaited<ReturnType<typeof cookies>>

/**
 * Copy one `Set-Cookie` header into Next's cookie store.
 *
 * Parsed rather than passed through because Next owns the outgoing headers on
 * a server action; the attributes that matter for a session cookie are carried
 * across and the rest are Better Auth's defaults anyway.
 */
export function applySetCookie(store: CookieStore, header: string): void {
  const [pair, ...attributes] = header.split(';')
  const index = pair?.indexOf('=') ?? -1
  if (!pair || index < 0) return

  const name = pair.slice(0, index).trim()
  const value = decodeURIComponent(pair.slice(index + 1).trim())

  const options: Parameters<CookieStore['set']>[2] = { path: '/' }
  for (const attribute of attributes) {
    const [rawKey, rawValue] = attribute.split('=')
    const key = rawKey?.trim().toLowerCase()
    const attributeValue = rawValue?.trim()
    if (key === 'path' && attributeValue) options.path = attributeValue
    else if (key === 'max-age' && attributeValue) options.maxAge = Number(attributeValue)
    else if (key === 'domain' && attributeValue) options.domain = attributeValue
    else if (key === 'samesite' && attributeValue)
      options.sameSite = attributeValue.toLowerCase() as 'lax' | 'strict' | 'none'
    else if (key === 'httponly') options.httpOnly = true
    else if (key === 'secure') options.secure = true
  }

  store.set(name, value, options)
}
