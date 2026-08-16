/**
 * Better Auth's handler — the only API route in the application.
 *
 * Everything else mutates through Server Actions. This exists because the auth
 * library owns its own endpoints, and there is no benefit in proxying them.
 */

import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

export const { GET, POST } = toNextJsHandler(auth)
