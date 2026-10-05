import 'server-only'
import { and, eq, gt } from 'drizzle-orm'
import { authVerification, systemActor, withActor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'

/**
 * Whether a password-reset link can still be used, asked when the page opens.
 *
 * The page used to accept any token and show the form, so a person with an
 * expired, used or mangled link typed a new password twice and only then read
 * "This link has expired". Better Auth keeps the token as an
 * `auth_verification` row named `reset-password:<token>`, and consumes it on
 * use, so a live unexpired row is exactly "this link still works".
 *
 * The system actor, because nobody is signed in on this page and the row is
 * not tenant data. Fixture mode has no database and no account to reset, so
 * no link works there. A database fault answers `true`: the form then shows,
 * and the action still refuses a bad token, which is the old behaviour rather
 * than a false "your link has expired".
 */
export async function resetTokenUsable(token: string): Promise<boolean> {
  if (usePilotFixtures()) return false
  try {
    const [row] = await withActor(systemActor(), (tx) =>
      tx
        .select({ id: authVerification.id })
        .from(authVerification)
        .where(
          and(
            eq(authVerification.identifier, `reset-password:${token}`),
            gt(authVerification.expiresAt, new Date()),
          ),
        )
        .limit(1),
    )
    return row !== undefined
  } catch {
    return true
  }
}
