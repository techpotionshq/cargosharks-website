/**
 * Create a real, signed-in-able user — FR-ID-07.
 *
 * The product is invitation-only: `disableSignUp` is set, so there is no
 * registration form and no way to bootstrap the first account through the
 * interface. This script is that path, and it is deliberately a script rather
 * than a hidden route — the first administrator of a freight platform should be
 * created by someone with shell access to the server, not by anyone who finds
 * a URL.
 *
 * It writes the four rows an account actually needs, in one transaction:
 *
 *   1. `auth_user`            — Better Auth's identity
 *   2. `auth_account`         — the credential, hashed with Better Auth's own
 *                               `hashPassword`, so the sign-in path verifies it
 *                               rather than a hash only this file understands
 *   3. `principals`           — the domain identity, linked by `auth_user_id`
 *   4. `principal_branch_roles` — a role *per branch* (FR-ID-02)
 *
 * Re-running for an existing email updates the password and the role grants
 * instead of failing, which is what makes it usable as a password reset before
 * the notification transport is configured.
 *
 * Usage:
 *   pnpm db:create-user --email a@b.com --name "Full Name" --role administrator \
 *     [--password '…'] [--branch KWI --branch DXB] [--locale en|ar] [--phone …]
 *
 * Omitting `--password` generates one and prints it once.
 */

import { randomUUID, randomBytes } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { loadEnv } from './env'
import { createDatabase } from './client'
import { systemActor, withActor } from './actor'
import { authAccount, authUser } from './schema/auth'
import { branches, principalBranchRoles, principals, roles } from './schema/identity'

loadEnv()

interface Options {
  email: string
  name: string
  nameAr?: string
  role: string
  password?: string
  branches: string[]
  locale: 'en' | 'ar'
  phone?: string
}

function parseArgs(argv: string[]): Options {
  const out: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg?.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      ;(out[key] ??= []).push('true')
    } else {
      ;(out[key] ??= []).push(value)
      i++
    }
  }

  const one = (key: string): string | undefined => out[key]?.[0]
  const email = one('email')
  const name = one('name')
  const role = one('role')

  if (!email || !name || !role) {
    throw new Error(
      'usage: pnpm db:create-user --email <email> --name <name> --role <role key> ' +
        '[--password <pw>] [--branch <code>]... [--locale en|ar] [--name-ar <name>] [--phone <phone>]',
    )
  }

  const locale = one('locale') === 'ar' ? 'ar' : 'en'

  return {
    email: email.trim().toLowerCase(),
    name: name.trim(),
    nameAr: one('name-ar')?.trim(),
    role: role.trim(),
    password: one('password'),
    branches: out['branch'] ?? [],
    locale,
    phone: one('phone'),
  }
}

/**
 * A generated password that survives being read aloud over a phone.
 *
 * No ambiguous glyphs, and long enough that the 12-character minimum is not
 * the thing standing between the pilot and a dictionary attack.
 */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(20)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  // The migration role: creating the first user necessarily happens before any
  // user exists to authorise it, so this cannot run under a principal's RLS
  // scope. It is the same argument the seed makes, and the same reason both are
  // scripts rather than routes.
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL must be set')

  const database = createDatabase({ connectionString: url, max: 1 })
  const password = options.password ?? generatePassword()
  const generated = !options.password

  if (password.length < 12) throw new Error('password must be at least 12 characters')

  await withActor(
    systemActor(),
    async (tx) => {
      const [role] = await tx
        .select({ id: roles.id, key: roles.key, requiresTwoFactor: roles.requiresTwoFactor })
        .from(roles)
        .where(eq(roles.key, options.role))
        .limit(1)

      if (!role) {
        const available = await tx.select({ key: roles.key }).from(roles)
        throw new Error(
          `unknown role "${options.role}" — available: ${available.map((r) => r.key).join(', ')}`,
        )
      }

      // No `--branch` means every active branch, which is what an administrator
      // almost always wants and what a coordinator almost never does. Being
      // explicit about the default beats silently granting one branch.
      const branchRows = options.branches.length
        ? await tx
            .select({ id: branches.id, code: branches.code })
            .from(branches)
            .where(inArray(branches.code, options.branches))
        : await tx.select({ id: branches.id, code: branches.code }).from(branches)

      if (!branchRows.length) {
        /*
          The bootstrap deadlock, named.

          Every permission in this system comes from `principal_branch_roles`
          (FR-ID-02), so an account with no branch role holds nothing — which
          is why this refuses rather than creating an inert user. On a fresh
          deployment there are no branches at all, and the only other way to
          make one is a screen that cannot be reached without an account.
        */
        throw new Error(
          options.branches.length
            ? `unknown branch: ${options.branches.join(', ')}`
            : [
                'This deployment has no branches, and a role is granted per branch —',
                'an account without one would hold no permissions at all.',
                '',
                '  Create the operating entity first:',
                '    pnpm db:create-branch --code KWI --name "<legal name>" --country KW --currency KWD',
              ].join('\n'),
        )
      }
      if (options.branches.length && branchRows.length !== options.branches.length) {
        const found = new Set(branchRows.map((b) => b.code))
        throw new Error(
          `unknown branch: ${options.branches.filter((c) => !found.has(c)).join(', ')}`,
        )
      }

      const passwordHash = await hashPassword(password)
      const now = new Date()

      const [existing] = await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, options.email))
        .limit(1)

      const userId = existing?.id ?? randomUUID()

      if (existing) {
        await tx
          .update(authUser)
          .set({ name: options.name, updatedAt: now })
          .where(eq(authUser.id, userId))
        await tx
          .update(authAccount)
          .set({ password: passwordHash, updatedAt: now })
          .where(eq(authAccount.userId, userId))
      } else {
        await tx.insert(authUser).values({
          id: userId,
          name: options.name,
          email: options.email,
          // There is no mail transport in the pilot environment, and an
          // unverified user cannot sign in. The invitation *is* the
          // verification: someone with shell access created this row.
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })
        await tx.insert(authAccount).values({
          id: randomUUID(),
          accountId: userId,
          providerId: 'credential',
          userId,
          password: passwordHash,
          createdAt: now,
          updatedAt: now,
        })
      }

      const [principal] = await tx
        .insert(principals)
        .values({
          type: 'internal',
          authUserId: userId,
          email: options.email,
          nameEn: options.name,
          nameAr: options.nameAr ?? null,
          locale: options.locale,
          phone: options.phone ?? null,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: principals.email,
          set: {
            authUserId: userId,
            nameEn: options.name,
            nameAr: options.nameAr ?? null,
            locale: options.locale,
            isActive: true,
            updatedAt: now,
          },
        })
        .returning({ id: principals.id })

      const principalId = principal!.id

      for (const branch of branchRows) {
        await tx
          .insert(principalBranchRoles)
          .values({ principalId, branchId: branch.id, roleId: role.id })
          .onConflictDoUpdate({
            target: [principalBranchRoles.principalId, principalBranchRoles.branchId],
            set: { roleId: role.id, updatedAt: now },
          })
      }

      console.log('')
      console.log(existing ? '  updated user' : '  created user')
      console.log(`  email     ${options.email}`)
      console.log(`  name      ${options.name}`)
      console.log(`  role      ${role.key}`)
      console.log(`  branches  ${branchRows.map((b) => b.code).join(', ')}`)
      if (generated) {
        console.log('')
        console.log(`  password  ${password}`)
        console.log('  ^ shown once — it is stored only as a hash.')
      }
      if (role.requiresTwoFactor) {
        console.log('')
        console.log(`  NOTE: the ${role.key} role requires two-factor enrolment (FR-ID-06).`)
        console.log('        Sign in once and complete TOTP setup before relying on this account.')
      }
      console.log('')
    },
    database,
  )

  await database.$client.end()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
