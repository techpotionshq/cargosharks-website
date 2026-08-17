/**
 * Create a branch — `pnpm db:create-branch`.
 *
 * The missing first step, and its absence was a deadlock rather than an
 * inconvenience.
 *
 * A fresh deployment has no branches: `db:seed` loads reference data and the
 * permission matrix, and a branch is neither — it is the operator's own legal
 * entity, with a registration, a base currency and a statutory invoice series
 * that nothing can invent. But **every grant of authority in this system hangs
 * off a branch** (FR-ID-02): permissions come from `principal_branch_roles`, so
 * a principal with no branch role holds no permission at all.
 *
 * So the documented sequence could not complete:
 *
 *   1. `db:migrate` and `db:seed` leave `branches` empty
 *   2. `db:create-user` fails outright — *"no matching branches"*
 *   3. nothing can sign in, so nobody can open `/settings/branches`
 *   4. which is the only other way to create a branch
 *
 * `db:seed-demo` failed for the same reason, one layer down: it resolves `KWI`
 * and `DXB` by code and writes `branch_id` from the result, so on an empty
 * table every insert violated a `not null`.
 *
 * This is deliberately its own command rather than something `db:seed` does
 * quietly. Seeding loads rows the engines need and cannot be wrong about; a
 * branch is a commercial fact about the customer, and inventing a placeholder
 * that later appears on an invoice is worse than asking for it once.
 *
 *     pnpm db:create-branch --code KWI --name "Al-Qabandi & Partners Co." \
 *                           --name-ar "شركة القبندي وشركاه" --country KW --currency KWD
 */

import { eq } from 'drizzle-orm'
import { loadEnv } from './env'
import { createDatabase } from './client'
import { systemActor, withActor } from './actor'
import { branches, workingCalendars } from './schema/index'

loadEnv()

interface Options {
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly country: string
  readonly currency: string
  readonly series: string
  readonly calendar: string
  readonly timeZone: string
}

function parseArgs(argv: string[]): Options {
  const one = (flag: string): string | undefined => {
    const index = argv.indexOf(`--${flag}`)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const code = one('code')?.toUpperCase()
  const nameEn = one('name')

  if (!code || !nameEn) {
    throw new Error(
      'Usage: pnpm db:create-branch --code <CODE> --name "<legal name>" ' +
        '[--name-ar "<الاسم>"] [--country KW] [--currency KWD] ' +
        '[--series <prefix>] [--calendar kuwait] [--time-zone Asia/Kuwait]',
    )
  }

  return {
    code,
    nameEn,
    /*
      The Arabic name falls back to the English one rather than to null.

      `legal_name_ar` is `not null` because every document this branch issues
      renders bilingually (§11), and a branch with no Arabic name produces an
      Arabic invoice with an English entity on it. Defaulting to the English
      string is honest — it is visibly untranslated, so it gets corrected —
      where a null would have to be handled at every render site instead.
    */
    nameAr: one('name-ar') ?? nameEn,
    country: (one('country') ?? 'KW').toUpperCase(),
    currency: (one('currency') ?? 'KWD').toUpperCase(),
    // The invoice series defaults to the branch code, which is what an
    // operator means by "our Kuwait numbering" until they say otherwise.
    series: one('series')?.toUpperCase() ?? code,
    calendar: one('calendar') ?? 'kuwait',
    timeZone: one('time-zone') ?? 'Asia/Kuwait',
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set — see .env.example')

  const db = createDatabase({ connectionString: url, max: 1 })

  await withActor(
    systemActor(),
    async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, options.calendar))
        .limit(1)

      if (!calendar) {
        throw new Error(
          `No working calendar "${options.calendar}". Run \`pnpm db:seed\` first — ` +
            'the calendar is what every SLA and ageing rule is counted against.',
        )
      }

      const [existing] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.code, options.code))
        .limit(1)

      if (existing) {
        console.log(`  branch ${options.code} already exists — leaving it alone`)
        return
      }

      await tx.insert(branches).values({
        code: options.code,
        legalNameEn: options.nameEn,
        legalNameAr: options.nameAr,
        country: options.country,
        baseCurrency: options.currency,
        invoiceSeries: options.series,
        calendarId: calendar.id,
        timeZone: options.timeZone,
      })

      console.log(`
  created branch
  code       ${options.code}
  name       ${options.nameEn}
  country    ${options.country}
  currency   ${options.currency}
  series     ${options.series}
  calendar   ${options.calendar}

  Next: pnpm db:create-user --email <you> --name "<you>" --role administrator
`)
    },
    db,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
