/**
 * Where a screen's data comes from.
 *
 * The pilot environment runs on seeded fixtures until the client's rate card
 * and job files land (Pilot §5, days 1–2), and on the real tables afterwards.
 * Both paths exist behind this one predicate so the switch is an environment
 * variable rather than a branch of the codebase — Pilot §1 is explicit that
 * *"everything in the pilot is Release One code with the scope dialled down,
 * so nothing is rebuilt afterwards"*, and a demo mode that forks the queries
 * would break exactly that promise.
 *
 * Fixtures are used when `QABANDI_PILOT_FIXTURES=1`, and by default when no
 * database is configured at all — which is what makes the interface runnable
 * on a laptop with nothing provisioned, including the day-15 rehearsal where
 * the room may have no network (Pilot §4).
 *
 * They are never used when `NODE_ENV=production` *and* a database is
 * configured. Seeded demo data reaching a real deployment is the one failure
 * mode here that would be worse than an empty screen.
 */

import 'server-only'

export function usePilotFixtures(): boolean {
  const explicit = process.env.QABANDI_PILOT_FIXTURES
  const hasDatabase = Boolean(process.env.DATABASE_URL)

  if (explicit === '0') return false
  if (explicit === '1') return !(process.env.NODE_ENV === 'production' && hasDatabase)
  return !hasDatabase
}

/**
 * Whether the fixtures ask a visitor to sign in — `QABANDI_DEMO_LOGIN=1`.
 *
 * This exists for one deployment: the public demo the marketing site links to.
 * A prospect arriving there should meet the product's own sign-in screen and
 * choose whose view they want — the forwarder's board, their customer's
 * portal, their agent's page — because "what does my customer see" is the
 * question the demo is answering. Seeing the form is part of the demo.
 *
 * Everywhere else it must stay off, and *off is the default*. With the flag
 * unset `getSession()` short-circuits to the pilot principal exactly as it
 * always has, which is what `pnpm test:e2e` is built on — the offline suite
 * authenticates nobody and loads no storage state, so a gate that engaged by
 * default would turn every screen in it into a sign-in redirect. The same goes
 * for every developer running `QABANDI_PILOT_FIXTURES=1 pnpm dev`.
 *
 * It is deliberately expressed as `usePilotFixtures() && …` rather than as a
 * flag test of its own. The demo personas are fixture data like any other, so
 * they inherit that predicate's refusal to engage in production against a
 * configured database — restating the condition here would be a second place
 * for it to be got wrong.
 */
export function useDemoLogin(): boolean {
  return usePilotFixtures() && process.env.QABANDI_DEMO_LOGIN === '1'
}
