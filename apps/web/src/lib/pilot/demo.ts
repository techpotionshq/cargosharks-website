/**
 * The demo personas — `QABANDI_DEMO_LOGIN=1`.
 *
 * One deployment uses this: the public demo the marketing site links to. It
 * runs on the pilot fixtures with no database at all, so there is no
 * `principals` table to authenticate against and no Better Auth to ask. What
 * it needs instead is three ways in, because the question a forwarder brings
 * to a demo is not "does it work" — it is *"what does my customer see, and
 * what does my agent see"*. One login can only ever answer a third of that.
 *
 * So there are three principals here and they are deliberately unequal:
 *
 *   operations  the pilot principal, unchanged, holding every permission.
 *   customer    a contact at the seeded portal customer. No branch, no role,
 *               no permission.
 *   agent       a contact at the origin agent named on the import jobs. The
 *               same: no branch, no role, no permission.
 *
 * The last two are not an oversight and not a simplification. A customer
 * contact and an agent contact hold no `principal_branch_roles` row in the
 * real product — `roles` is seven internal roles and `db/create-user.ts`
 * assigns one only to internal staff, so an agent login assembles an empty
 * permission set and sees jobs solely because the `agent_contact` arm of the
 * RLS policy matches their partner. Handing the demo's portal login
 * `allPermissionKeys()` would make it a login that can open the whole
 * operations board, which is a demo that disproves the tenancy claim it exists
 * to demonstrate.
 *
 * Nothing in this file can engage without `useDemoLogin()`, which is
 * `usePilotFixtures()` and the flag — see `source.ts`.
 */

import 'server-only'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import type { Session } from '@/lib/session'
import { PILOT_AGENT_PARTNER, PILOT_PORTAL_CUSTOMER } from '@/lib/pilot/fixtures'
import { DEFAULT_TIME_ZONE } from '@/lib/time'

type DemoPersonaKey = 'operations' | 'customer' | 'agent'

export interface DemoPersona {
  readonly key: DemoPersonaKey
  readonly email: string
  readonly nameEn: string
  readonly nameAr: string
  /** The company the person belongs to — the operator, a customer, an agent. */
  readonly orgEn: string
  readonly orgAr: string
  /** Where `homeFor()` sends them; stated so the panel can say it. */
  readonly home: '/dashboard' | '/portal' | '/agent'
}

/**
 * The agency the demo agent contact works for.
 *
 * `partnersFor()` in the fixtures names Hongqiao as the origin agent on the
 * China imports, so this is the partner an agent contact would actually be
 * looking at jobs through — and its id is the partner register's own, the one
 * the job's partner panel carries. It used to be an invented uuid "so the
 * actor had the right shape", and since `pilotAgentShipments` filters on
 * exactly that id, the demo's agent login opened on "Nothing assigned to you".
 * The shape that matters is that the actor names a partner the jobs name too.
 */
const DEMO_PARTNER = {
  id: PILOT_AGENT_PARTNER.id,
  nameEn: PILOT_AGENT_PARTNER.en,
  nameAr: PILOT_AGENT_PARTNER.ar,
} as const

/** Likewise for the customer — `pilotPortalShipments()` filters on the name. */
const DEMO_CUSTOMER_ID = '00000000-0000-7000-8000-0000000000d1'

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    key: 'operations',
    /*
      The pilot principal's own address, character for character — signing in
      as this persona *is* signing in as `PILOT_SESSION` in `lib/session.ts`,
      which is where the name and the permissions come from. Changed in one
      place and not the other, the demo panel would advertise an address that
      no longer matches the session it hands out.
    */
    email: 'operations@cargosharks.example',
    nameEn: 'Fahad Al-Rashid',
    nameAr: 'فهد الرشيد',
    orgEn: 'Operations manager',
    orgAr: 'مدير العمليات',
    home: '/dashboard',
  },
  {
    key: 'customer',
    email: 'customer@gulfsteel.example',
    nameEn: 'Dana Al-Kandari',
    nameAr: 'دانة الكندري',
    orgEn: PILOT_PORTAL_CUSTOMER.en,
    orgAr: PILOT_PORTAL_CUSTOMER.ar,
    home: '/portal',
  },
  {
    key: 'agent',
    email: 'agent@everbright.example',
    nameEn: 'Wei Chen',
    nameAr: 'وي تشن',
    orgEn: DEMO_PARTNER.nameEn,
    orgAr: DEMO_PARTNER.nameAr,
    home: '/agent',
  },
]

/**
 * One password for all three, printed on the sign-in screen.
 *
 * A demo whose credentials are not on the screen is a demo nobody gets into,
 * so there is no secret here to protect and the default is documented in
 * `.env.example`. `QABANDI_DEMO_PASSWORD` exists so a deployment can change it
 * — a demo behind a password a prospect was given in an email is still a
 * useful thing to be able to stand up.
 */
export function demoPassword(): string {
  return process.env.QABANDI_DEMO_PASSWORD || 'cargosharks-demo'
}

/**
 * Constant-time comparison, and worth saying plainly what it is *not*.
 *
 * This is a demo gate, not a security boundary. It guards seeded fixtures on a
 * deployment with no database behind it; the password is printed a few
 * centimetres above the field it goes in. `timingSafeEqual` is here because a
 * `===` on a secret is the kind of thing that gets copied into a file where it
 * does matter, and because a length-leaking compare in an authentication path
 * is not worth arguing about in review. Nobody should ever read this function
 * as evidence that the demo protects anything.
 */
export function demoPasswordMatches(supplied: string): boolean {
  // `timingSafeEqual` throws on a length mismatch rather than returning false,
  // which would leak the length through an exception instead of through a
  // clock. Hashing both to a fixed width sidesteps it.
  return timingSafeEqual(digest(demoPassword()), digest(supplied))
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** The persona a typed address selects, or nothing. */
export function demoPersonaByEmail(email: string): DemoPersona | undefined {
  const normalised = email.trim().toLowerCase()
  return DEMO_PERSONAS.find((persona) => persona.email === normalised)
}

/**
 * The signing key for the cookie below.
 *
 * `BETTER_AUTH_SECRET` where a deployment sets one, and otherwise thirty-two
 * random bytes for the life of the process. The fallback is not a weakness so
 * much as a session lifetime: restart the demo and everyone signs in again,
 * which for a demo is nothing. What it must never be is *derived from the
 * password*, because the password is on the screen — a key anyone can read is
 * a signature anyone can forge, which is the whole thing this is here to stop.
 */
const SIGNING_KEY = process.env.BETTER_AUTH_SECRET || randomBytes(32).toString('base64')

/**
 * The demo cookie.
 *
 * `<persona>.<hmac>`, signed rather than stored plain, and the reason is the
 * point of the three personas. A cookie whose value is the literal string
 * `customer` is one a visitor edits to `operations` in the developer tools,
 * and the demo would then hand the customer-portal login the whole operations
 * board — refuting, live, the tenancy claim it was opened to demonstrate. The
 * signature makes tampering fail closed: an unrecognised or unsigned value
 * resolves to no session at all, and the visitor lands back on the form.
 *
 * The name starts `qabandi.` deliberately. `signOut` in
 * `features/auth/actions.ts` clears every cookie under that prefix, so the
 * demo signs out through the same action every shell already posts to rather
 * than needing a path of its own.
 */
const DEMO_COOKIE = 'qabandi.demo_persona'

function sign(key: DemoPersonaKey): string {
  return createHmac('sha256', SIGNING_KEY).update(key).digest('base64url')
}

/** Sets the cookie. Attributes live here so there is one copy of them. */
export async function startDemoSession(persona: DemoPersona): Promise<void> {
  const store = await cookies()
  store.set(DEMO_COOKIE, `${persona.key}.${sign(persona.key)}`, {
    httpOnly: true,
    sameSite: 'lax',
    // The public demo is served over HTTPS; a laptop is not.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  })
}

/**
 * The session the cookie names, or `null` — which is what makes a signed-out
 * visitor meet the form rather than the dashboard.
 *
 * The internal persona is `PILOT_SESSION` itself, passed in rather than
 * imported: `lib/session.ts` imports this module, and reaching back for the
 * constant would close the cycle. It is also the reason the operations persona
 * cannot drift from the pilot one — there is only ever the one object.
 */
export async function demoSession(pilot: Session): Promise<Session | null> {
  const store = await cookies()
  const raw = store.get(DEMO_COOKIE)?.value
  if (!raw) return null

  const separator = raw.lastIndexOf('.')
  if (separator < 0) return null

  const key = raw.slice(0, separator)
  const persona = DEMO_PERSONAS.find((candidate) => candidate.key === key)
  if (!persona) return null

  const supplied = Buffer.from(raw.slice(separator + 1), 'base64url')
  const expected = Buffer.from(sign(persona.key), 'base64url')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null

  return sessionFor(persona, pilot)
}

function sessionFor(persona: DemoPersona, pilot: Session): Session {
  if (persona.key === 'operations') return pilot

  const isCustomer = persona.key === 'customer'

  return {
    actor: {
      principalId: isCustomer
        ? '00000000-0000-7000-8000-0000000000a2'
        : '00000000-0000-7000-8000-0000000000a3',
      type: isCustomer ? 'customer_contact' : 'agent_contact',
      /*
        Empty, and that is what a real one looks like. A branch role is an
        internal grant (`0002` constrains a `customer_contact` to a customer
        and a `partner_id` of null; `create-user.ts` gives a role only to
        staff), so a contact's scope is the one id below and the policy arm it
        matches — not a list of branches.
      */
      branchIds: [],
      customerId: isCustomer ? DEMO_CUSTOMER_ID : null,
      partnerId: isCustomer ? null : DEMO_PARTNER.id,
      ip: null,
    },
    principal: {
      id: isCustomer
        ? '00000000-0000-7000-8000-0000000000a2'
        : '00000000-0000-7000-8000-0000000000a3',
      nameEn: persona.nameEn,
      nameAr: persona.nameAr,
      email: persona.email,
      locale: 'en',
      timezone: DEFAULT_TIME_ZONE,
    },
    // Not `allPermissionKeys()`, and not a trimmed subset of it either — the
    // real thing is empty. See the note at the top of the file.
    permissions: new Set<string>(),
    branchRoles: new Map<string, string>(),
    requiresTwoFactor: false,
  }
}

/**
 * The agency name for the agent shell's header.
 *
 * The fixtures have no partner register to look a name up in, and the only
 * actor that carries a `partner_id` in fixture mode is the demo agent — so the
 * lookup is this one row. `features/network/queries.ts` calls it in place of
 * the query it would otherwise run through `withActor`, which on a demo
 * deployment has no database to reach.
 */
export function demoPartnerName(partnerId: string, locale: 'en' | 'ar'): string | null {
  if (partnerId !== DEMO_PARTNER.id) return null
  return locale === 'ar' ? DEMO_PARTNER.nameAr : DEMO_PARTNER.nameEn
}
