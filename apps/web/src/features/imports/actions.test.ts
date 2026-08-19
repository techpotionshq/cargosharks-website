/**
 * Bulk import — the one action in the product that can write two thousand rows
 * on a single click, and the only one where "it partly worked" is the worst
 * possible outcome.
 *
 * Three properties are asserted here and cannot be asserted anywhere else,
 * because each is a claim about the *pair* of passes rather than about either
 * one:
 *
 * **`check` writes nothing.** Proved by counting the table before and after,
 * not by trusting that the switch fell the right way. A preview that quietly
 * inserted would be indistinguishable from a working one until the operator
 * pressed Cancel.
 *
 * **A file with errors imports nothing.** Not "stops at the bad row" — nothing.
 * The rows are written inside one `withActor` transaction, so a failure on line
 * nine hundred unwinds the eight hundred and ninety-nine before it. The
 * cutover suites below check the count is unchanged after a refusal.
 *
 * **The second validation is not redundant.** The report the browser holds is a
 * claim by the client; the reference data may have moved since. `commit`
 * re-reads and re-validates, which is why the collision tests here submit the
 * same file twice rather than asserting on a returned report.
 *
 * The cutover pair — open jobs and open receivables — carry the most weight.
 * They run once, against a live handover, on the morning a business stops using
 * its old system, and the failure mode is not an exception but a plausible
 * wrong number in an ageing report nobody reconciles for a month.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const {
  customerBranchTerms,
  customerContacts,
  customers,
  invoices,
  jobs,
  locations,
  partners,
  rateCardLines,
  rateCards,
  withActor,
} = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PARTNER, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { runImport } = await import('./actions')

const ALL_IMPORT_PERMISSIONS = [
  'customer.write',
  'partner.write',
  'admin.reference.write',
  'rate.card.write',
  'job.read',
  'finance.export',
]

function sessionWith(permissions: readonly string[]) {
  return {
    actor: bothBranchesActor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Import Operator',
      nameAr: null,
      email: 'imports@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([
      [HOME_BRANCH, 'operations_manager'],
      [AWAY_BRANCH, 'operations_manager'],
    ]),
    requiresTwoFactor: false,
  }
}

/* --------------------------------------------------------------- the sheets */

/** A run-unique suffix, so suites sharing a database do not collide on codes. */
const RUN = Date.now().toString(36).toUpperCase().slice(-6)
let seq = 0
const unique = (prefix: string) => `${prefix}${RUN}${(seq += 1)}`

const sheet = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header.join(','), ...rows.map((row) => row.join(','))].join('\n')

/**
 * The form the browser posts. `file` is a real `File` because the action reads
 * `.size`, `.name` and `.text()` off it, and a hand-rolled stand-in would let a
 * change to any of those pass here and fail in a browser.
 */
function upload(
  kind: string,
  content: string,
  extra: Record<string, string> = {},
  fileName = 'sheet.csv',
): FormData {
  const form = new FormData()
  form.set('kind', kind)
  form.set('file', new File([content], fileName, { type: 'text/csv' }))
  for (const [key, value] of Object.entries(extra)) form.set(key, value)
  return form
}

const CUSTOMER_HEADER = [
  'Customer code',
  'Legal name (English)',
  'Legal name (Arabic)',
  'Country',
  'Payment terms (days)',
]

const customerSheet = (code: string) =>
  sheet(CUSTOMER_HEADER, [[code, 'Imported Trading Co', 'شركة مستوردة', 'KW', '30']])

/* ------------------------------------------------------------------ counting */

/**
 * How many of *these* codes exist — not how many customers there are.
 *
 * A count of the whole table was the obvious spelling and it measured the
 * scheduler: the customers suite writes customers too, the runner executes the
 * files in parallel, and anything it inserted between the before and the after
 * read as an import that had written something. Counting the codes this file
 * put in the sheet is exact and cannot be moved by anyone else.
 */
const countCodes = async (...codes: string[]): Promise<number> => {
  const result = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({ code: customers.code })
      .from(customers)
      .where(inArray(customers.code, codes)),
  )
  return result.length
}

describe.skipIf(!enabled)('bulk import', () => {
  beforeAll(async () => {
    await world()
    harness.session = sessionWith(ALL_IMPORT_PERMISSIONS)
  })

  afterAll(() => {
    harness.session = null
  })

  describe('refusing before it reads anything', () => {
    it('names an unknown sheet rather than guessing one', async () => {
      const state = await runImport({}, upload('invoices-maybe', 'a,b\n1,2'))
      expect(state.error).toBe('unknown_kind')
    })

    it('asks for a file when none was attached', async () => {
      const form = new FormData()
      form.set('kind', 'customers')
      expect((await runImport({}, form)).error).toBe('no_file')
    })

    /** An empty upload is a mis-click, not a file with no rows. */
    it('treats a zero-byte upload as no file at all', async () => {
      const state = await runImport({}, upload('customers', '', { branchId: HOME_BRANCH }))
      expect(state.error).toBe('no_file')
    })

    it('refuses a file past the size ceiling before parsing it', async () => {
      const huge = 'Customer code,Legal name (English)\n'.padEnd(9 * 1024 * 1024, 'x')
      const state = await runImport({}, upload('customers', huge, { branchId: HOME_BRANCH }))

      expect(state.error).toBe('too_large')
      expect(state.fileName).toBe('sheet.csv')
    })

    /**
     * Stated once in `importNeedsBranch` and read by both the action and the
     * page, because deciding it twice gave a form with no branch selector whose
     * submit failed on a `not null` at the end of a two-thousand-row write.
     */
    it('insists on a destination branch for a branch-scoped sheet', async () => {
      const state = await runImport({}, upload('customers', customerSheet(unique('NB'))))
      expect(state.error).toBe('no_branch')
    })

    it('needs no branch for a sheet that writes nothing branch-scoped', async () => {
      const state = await runImport(
        {},
        upload('partners', sheet(['Partner code', 'Type', 'Legal name (English)'], [])),
      )
      expect(state.error).toBeUndefined()
    })

    it('refuses a branch the operator does not hold', async () => {
      await expect(
        runImport(
          {},
          upload('customers', customerSheet(unique('XB')), {
            branchId: '00000000-0000-7000-8000-0000000000ff',
          }),
        ),
      ).rejects.toThrow('branch:')
    })

    it('refuses a sheet the operator may not write', async () => {
      harness.session = sessionWith(['customer.write'])
      try {
        await expect(
          runImport({}, upload('partners', sheet(['Partner code'], []))),
        ).rejects.toThrow('partner.write')
      } finally {
        harness.session = sessionWith(ALL_IMPORT_PERMISSIONS)
      }
    })
  })

  describe('checking, which writes nothing', () => {
    it('reports a clean sheet as clean and leaves the table alone', async () => {
      const code = unique('CK')

      const state = await runImport(
        {},
        upload('customers', customerSheet(code), { branchId: HOME_BRANCH }),
      )

      expect(state.ok).toBe(true)
      expect(state.totalRows).toBe(1)
      expect(state.acceptedRows).toBe(1)
      expect(state.issueCount).toBe(0)
      expect(state.committed).toBeUndefined()
      // The preview parsed it and wrote nothing.
      expect(await countCodes(code)).toBe(0)
    })

    it('hands back the headings it found and the mapping it inferred', async () => {
      const state = await runImport(
        {},
        upload('customers', customerSheet(unique('HD')), { branchId: HOME_BRANCH }),
      )

      expect(state.headers).toContain('Customer code')
      expect(state.mapping).toBeDefined()
      expect(state.fileName).toBe('sheet.csv')
    })

    it('reports a bad row as an issue rather than refusing the file', async () => {
      const state = await runImport(
        {},
        upload(
          'customers',
          sheet(CUSTOMER_HEADER, [
            [unique('OK'), 'Fine Trading', 'جيد', 'KW', '30'],
            [unique('XX'), 'Bad Country', 'سيئ', 'ZZ', '30'],
          ]),
          { branchId: HOME_BRANCH },
        ),
      )

      expect(state.ok).toBe(false)
      expect(state.issueCount).toBe(1)
      expect(state.issues?.[0]?.column).toBe('Country')
    })

    /**
     * The acceptance criterion, at the level it is written: a file with errors
     * imports **nothing**, including the rows that were fine.
     */
    it('writes nothing at all when a commit carries one bad row', async () => {
      const good = unique('G1')
      const bad = unique('B1')

      const state = await runImport(
        {},
        upload(
          'customers',
          sheet(CUSTOMER_HEADER, [
            [good, 'Good One', 'جيد', 'KW', '30'],
            [bad, 'Bad One', 'سيئ', 'ZZ', '30'],
          ]),
          { branchId: HOME_BRANCH, intent: 'commit' },
        ),
      )

      expect(state.ok).toBe(false)
      expect(state.committed).toBeUndefined()
      // Including the row that was perfectly good — that is the criterion.
      expect(await countCodes(good, bad)).toBe(0)
    })
  })

  describe('the column mapping the operator corrected', () => {
    /**
     * Headings a real sheet carries. The mapping is how an operator says "the
     * third column is the country" when the export called it something else.
     */
    it('honours an explicit mapping over the headings', async () => {
      const state = await runImport(
        {},
        upload(
          'customers',
          sheet(
            ['A', 'B', 'C'],
            [[unique('MP'), 'Mapped Trading', 'KW']],
          ),
          {
            branchId: HOME_BRANCH,
            mapping: JSON.stringify({ code: 0, legalNameEn: 1, countryCode: 2 }),
          },
        ),
      )

      expect(state.ok).toBe(true)
      expect(state.acceptedRows).toBe(1)
    })

    it('ignores a mapping that is not JSON rather than failing the import', async () => {
      const state = await runImport(
        {},
        upload('customers', customerSheet(unique('MJ')), {
          branchId: HOME_BRANCH,
          mapping: 'not json at all',
        }),
      )
      expect(state.ok).toBe(true)
    })

    /**
     * A JSON array is `typeof 'object'`, so without the `Array.isArray` guard
     * it became a mapping keyed `0`, `1`, `2` — naming no column, unmapping
     * every field, and reporting a perfectly good sheet as missing its
     * required columns.
     */
    it('ignores a mapping that is JSON but not an object', async () => {
      const state = await runImport(
        {},
        upload('customers', customerSheet(unique('MA')), {
          branchId: HOME_BRANCH,
          mapping: '[1,2,3]',
        }),
      )
      expect(state.ok).toBe(true)
    })

    it('drops a column whose mapped index is not a real one', async () => {
      const state = await runImport(
        {},
        upload('customers', customerSheet(unique('MN')), {
          branchId: HOME_BRANCH,
          mapping: JSON.stringify({ code: 'first', legalNameEn: -1, countryCode: 1.5 }),
        }),
      )
      // Nothing usable was mapped, so the required columns are missing.
      expect(state.ok).toBe(false)
    })
  })

  describe('customers', () => {
    it('writes the customer and the terms together', async () => {
      const code = unique('CU')
      const state = await runImport(
        {},
        upload('customers', customerSheet(code), { branchId: HOME_BRANCH, intent: 'commit' }),
      )

      expect(state.committed?.records).toBe(1)

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ id: customers.id, nameAr: customers.legalNameAr })
          .from(customers)
          .where(eq(customers.code, code)),
      )
      expect(row?.nameAr).toBe('شركة مستوردة')

      // A customer with no payment terms is one nobody can invoice.
      const terms = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ days: customerBranchTerms.paymentTermsDays })
          .from(customerBranchTerms)
          .where(eq(customerBranchTerms.customerId, row!.id)),
      )
      expect(terms[0]?.days).toBe(30)
    })

    /**
     * The collision set doing its job on the second run of a migration — the
     * usual case, since a cutover is run against a dry copy first.
     */
    it('refuses a code the second run would duplicate', async () => {
      const code = unique('CD')
      const commit = { branchId: HOME_BRANCH, intent: 'commit' }

      await runImport({}, upload('customers', customerSheet(code), commit))
      const again = await runImport({}, upload('customers', customerSheet(code), commit))

      expect(again.ok).toBe(false)
      expect(again.committed).toBeUndefined()
      expect(again.issues?.[0]?.field).toBe('code')
      expect(again.issues?.[0]?.message).toContain('already exists in the system')
    })

    it('refuses two rows in one file claiming the same code', async () => {
      const code = unique('CT')
      const state = await runImport(
        {},
        upload(
          'customers',
          sheet(CUSTOMER_HEADER, [
            [code, 'First Claim', 'أول', 'KW', '30'],
            [code, 'Second Claim', 'ثاني', 'KW', '30'],
          ]),
          { branchId: HOME_BRANCH },
        ),
      )
      expect(state.ok).toBe(false)
    })
  })

  describe('customer contacts', () => {
    /** Imported after customers, which is the order of the registry and of a migration. */
    async function customerFor(): Promise<string> {
      const code = unique('CC')
      await runImport(
        {},
        upload('customers', customerSheet(code), { branchId: HOME_BRANCH, intent: 'commit' }),
      )
      return code
    }

    it('attaches a contact to the customer named by code', async () => {
      const code = await customerFor()

      const state = await runImport(
        {},
        upload(
          'customer-contacts',
          sheet(
            ['Customer code', 'Contact name', 'Email', 'Primary contact'],
            [[code, 'Fatima Al-Rashid', 'fatima@example.com', 'yes']],
          ),
          { intent: 'commit' },
        ),
      )

      expect(state.committed?.records).toBe(1)

      const [customer] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: customers.id }).from(customers).where(eq(customers.code, code)),
      )
      const contacts = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ nameEn: customerContacts.nameEn, isPrimary: customerContacts.isPrimary })
          .from(customerContacts)
          .where(eq(customerContacts.customerId, customer!.id)),
      )
      expect(contacts[0]?.nameEn).toBe('Fatima Al-Rashid')
      expect(contacts[0]?.isPrimary).toBe(true)
    })

    /**
     * Caught at the write rather than in the descriptor, because only the
     * database knows which codes exist — and reported as `unknown_reference`
     * rather than as a crash.
     */
    it('refuses a contact whose customer does not exist', async () => {
      const state = await runImport(
        {},
        upload(
          'customer-contacts',
          sheet(['Customer code', 'Contact name'], [['NO-SUCH-CODE', 'Nobody At All']]),
          { intent: 'commit' },
        ),
      )
      expect(state.error).toBe('unknown_reference')
    })
  })

  describe('partners', () => {
    it('writes an agent', async () => {
      const code = unique('PT')
      const state = await runImport(
        {},
        upload(
          'partners',
          sheet(
            ['Partner code', 'Type', 'Legal name (English)', 'Country', 'Currency'],
            [[code, 'agent', 'Imported Agency', 'AE', 'USD']],
          ),
          { intent: 'commit' },
        ),
      )

      expect(state.committed?.records).toBe(1)
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ type: partners.type, currency: partners.currency })
          .from(partners)
          .where(eq(partners.code, code)),
      )
      expect(row?.type).toBe('agent')
      expect(row?.currency).toBe('USD')
    })

    it('refuses a type the platform does not model', async () => {
      const state = await runImport(
        {},
        upload(
          'partners',
          sheet(
            ['Partner code', 'Type', 'Legal name (English)'],
            [[unique('PB'), 'consultant', 'Not A Partner Type']],
          ),
        ),
      )
      expect(state.ok).toBe(false)
      expect(state.issues?.[0]?.column).toBe('Type')
    })
  })

  describe('locations', () => {
    /*
      A UN/LOCODE is five characters, so there are only three to make unique
      with. The low base-36 digits of the clock turn over every millisecond,
      which is what two runs of this suite seconds apart need — the high ones
      hold still for three quarters of a minute and collided.
    */
    it('writes a port', async () => {
      const unlocode = `KW${Date.now().toString(36).toUpperCase().slice(-3)}`
      const state = await runImport(
        {},
        upload(
          'locations',
          sheet(
            ['UN/LOCODE', 'Name (English)', 'Name (Arabic)', 'Country', 'Kind'],
            [[unlocode, 'Imported Port', 'ميناء', 'KW', 'seaport']],
          ),
          { intent: 'commit' },
        ),
      )

      expect(state.committed?.records).toBe(1)
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ kind: locations.kind })
          .from(locations)
          .where(eq(locations.unlocode, unlocode)),
      )
      expect(row?.kind).toBe('seaport')
    })

    it('refuses a UN/LOCODE already in use', async () => {
      const state = await runImport(
        {},
        upload(
          'locations',
          sheet(
            ['UN/LOCODE', 'Name (English)', 'Country', 'Kind'],
            [['KWSWK', 'Shuwaikh Again', 'KW', 'seaport']],
          ),
        ),
      )
      expect(state.ok).toBe(false)
      expect(state.issues?.[0]?.field).toBe('unlocode')
      expect(state.issues?.[0]?.message).toContain('already exists in the system')
    })
  })

  describe('open jobs — the cutover handover', () => {
    const JOB_HEADER = [
      'Job reference',
      'Customer code',
      'Status',
      'Mode',
      'Direction',
      'Origin',
      'Destination',
      'Incoterm',
      'Vessel',
      'ETA',
    ]

    const jobRow = (reference: string) => [
      reference,
      'CUST-FIXTURE-HOME',
      'in_transit',
      'FCL',
      'import',
      'KWSWK',
      'AEJEA',
      'fob',
      'MV Handover',
      '2026-10-01',
    ]

    /**
     * The reference is kept, not renumbered: operations, the customer and the
     * carrier all have the old file number written down.
     */
    it('keeps the old file number and resolves its lane', async () => {
      const reference = unique('OJ-')
      const state = await runImport(
        {},
        upload('open-jobs', sheet(JOB_HEADER, [jobRow(reference)]), {
          branchId: HOME_BRANCH,
          intent: 'commit',
        }),
      )

      expect(state.committed?.records).toBe(1)

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            status: jobs.status,
            mode: jobs.mode,
            incoterm: jobs.incoterm,
            originId: jobs.originId,
            destinationId: jobs.destinationId,
            vesselName: jobs.vesselName,
          })
          .from(jobs)
          .where(eq(jobs.reference, reference)),
      )

      expect(row?.status).toBe('in_transit')
      // `FCL` is what an agent actually writes; `sea_fcl` is what we store.
      expect(row?.mode).toBe('sea_fcl')
      expect(row?.incoterm).toBe('FOB')
      expect(row?.originId).toBeTruthy()
      expect(row?.destinationId).toBeTruthy()
      expect(row?.vesselName).toBe('MV Handover')
    })

    /**
     * No milestones. A job imported mid-passage has already passed most of a
     * template's steps, and writing them as incomplete would put forty
     * shipments on the exceptions board on the morning of go-live.
     */
    it('generates no milestone trail for a shipment already in flight', async () => {
      const reference = unique('OM-')
      await runImport(
        {},
        upload('open-jobs', sheet(JOB_HEADER, [jobRow(reference)]), {
          branchId: HOME_BRANCH,
          intent: 'commit',
        }),
      )

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.reference, reference)),
      )
      const milestones = await withActor(bothBranchesActor, (tx) =>
        tx.execute(sql`select count(*)::int as n from job_milestones where job_id = ${row!.id}`),
      )
      expect((milestones.rows[0] as { n: number }).n).toBe(0)
    })

    it('refuses a reference the first run already carried over', async () => {
      const reference = unique('OD-')
      const commit = { branchId: HOME_BRANCH, intent: 'commit' }

      await runImport({}, upload('open-jobs', sheet(JOB_HEADER, [jobRow(reference)]), commit))
      const again = await runImport(
        {},
        upload('open-jobs', sheet(JOB_HEADER, [jobRow(reference)]), commit),
      )

      expect(again.ok).toBe(false)
      expect(again.committed).toBeUndefined()
    })

    it('refuses a shipment whose customer was never imported', async () => {
      const row = jobRow(unique('OU-'))
      row[1] = 'NEVER-IMPORTED-CODE'

      const state = await runImport(
        {},
        upload('open-jobs', sheet(JOB_HEADER, [row]), {
          branchId: HOME_BRANCH,
          intent: 'commit',
        }),
      )
      expect(state.error).toBe('unknown_reference')
    })
  })

  describe('open receivables — the opening balances', () => {
    const AR_HEADER = [
      'Invoice number',
      'Customer code',
      'Currency',
      'Issue date',
      'Due date',
      'Net amount',
      'Tax amount',
      'Gross total',
      'Amount received',
    ]

    const arRow = (
      seriesNo: string,
      { net = '100.000', tax = '0.000', total = '100.000', paid = '0.000' } = {},
    ) => [
      seriesNo,
      'CUST-FIXTURE-HOME',
      'KWD',
      '2026-01-15',
      '2026-02-15',
      net,
      tax,
      total,
      paid,
    ]

    it('writes a wholly unpaid balance as issued', async () => {
      const seriesNo = unique('AR-')
      const state = await runImport(
        {},
        upload('open-receivables', sheet(AR_HEADER, [arRow(seriesNo)]), {
          branchId: HOME_BRANCH,
          intent: 'commit',
        }),
      )

      expect(state.committed?.records).toBe(1)

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ status: invoices.status, total: invoices.total, notes: invoices.notes })
          .from(invoices)
          .where(eq(invoices.seriesNo, seriesNo)),
      )
      expect(row?.status).toBe('issued')
      expect(Number(row?.total)).toBeCloseTo(100, 3)
      expect(row?.notes).toContain('Opening balance')
    })

    /** Part-payment is normal, and the ageing report needs both halves. */
    it('writes a part-paid balance as part_paid', async () => {
      const seriesNo = unique('AP-')
      await runImport(
        {},
        upload(
          'open-receivables',
          sheet(AR_HEADER, [arRow(seriesNo, { paid: '40.000' })]),
          { branchId: HOME_BRANCH, intent: 'commit' },
        ),
      )

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ status: invoices.status, paid: invoices.amountPaid })
          .from(invoices)
          .where(eq(invoices.seriesNo, seriesNo)),
      )
      expect(row?.status).toBe('part_paid')
      expect(Number(row?.paid)).toBeCloseTo(40, 3)
    })

    /**
     * The three arithmetic checks, each catching a different real defect in a
     * handover sheet. A tolerance of half a fils, because KWD carries three
     * decimals and a per-line rounded export will not foot exactly.
     */
    it('refuses a row whose net and tax do not foot to the total', async () => {
      const state = await runImport(
        {},
        upload(
          'open-receivables',
          sheet(AR_HEADER, [arRow(unique('AF-'), { tax: '5.000', total: '100.000' })]),
          { branchId: HOME_BRANCH },
        ),
      )
      expect(state.ok).toBe(false)
      expect(state.issues?.[0]?.message).toContain('does not equal total')
    })

    it('refuses a settled invoice, which is not an open receivable', async () => {
      const state = await runImport(
        {},
        upload(
          'open-receivables',
          sheet(AR_HEADER, [arRow(unique('AS-'), { paid: '100.000' })]),
          { branchId: HOME_BRANCH },
        ),
      )
      expect(state.ok).toBe(false)
      expect(state.issues?.[0]?.message).toContain('Nothing outstanding')
    })

    it('refuses an overpayment rather than importing a negative balance', async () => {
      const state = await runImport(
        {},
        upload(
          'open-receivables',
          sheet(AR_HEADER, [arRow(unique('AO-'), { paid: '150.000' })]),
          { branchId: HOME_BRANCH },
        ),
      )
      expect(state.ok).toBe(false)
      expect(state.issues?.[0]?.message).toContain('credit note')
    })

    it('refuses a balance whose customer was never imported', async () => {
      const row = arRow(unique('AN-'))
      row[1] = 'NEVER-IMPORTED-CODE'

      const state = await runImport(
        {},
        upload('open-receivables', sheet(AR_HEADER, [row]), {
          branchId: HOME_BRANCH,
          intent: 'commit',
        }),
      )
      expect(state.error).toBe('unknown_reference')
    })
  })

  describe('rate cards — FR-RT-09', () => {
    const RATE_HEADER = [
      'Mode',
      'Origin',
      'Destination',
      'Currency',
      'Valid from',
      'Valid to',
      'Charge',
      'Basis',
      'Rate',
      'Container',
    ]

    /**
     * A validity window nothing else has claimed.
     *
     * `rate_cards_no_overlap` is `UNIQUE … WITHOUT OVERLAPS` on the lane, so a
     * fixed pair of dates would make this suite pass once and fail on every
     * subsequent run against the same database — and fail as a `conflict`,
     * which looks like a broken assertion rather than a stale row. Each tariff
     * takes its own day.
     */
    const FIRST_DAY = Math.floor(Date.now() / 1000) % 100_000
    let day = 0
    function window(): { from: string; to: string } {
      const start = Date.UTC(2030, 0, 1) + (FIRST_DAY + (day += 1)) * 86_400_000
      return {
        from: new Date(start).toISOString().slice(0, 10),
        to: new Date(start + 86_400_000).toISOString().slice(0, 10),
      }
    }

    /**
     * `Container` is not decoration: a per-container rate with no equipment
     * type cannot be applied to a booking, and the descriptor refuses it.
     */
    const rateRow = (
      charge: string,
      rate: string,
      {
        basis = 'per container',
        container = '20GP',
        validity = window(),
      }: { basis?: string; container?: string; validity?: { from: string; to: string } } = {},
    ) => [
      'FCL',
      'KWSWK',
      'AEJEA',
      'USD',
      validity.from,
      validity.to,
      charge,
      basis,
      rate,
      container,
    ]

    const FLAT = { basis: 'flat', container: '' }
    const LUMP_SUM = { basis: 'lump sum', container: '' }

    /** A buy tariff belongs to whoever quoted it, or it belongs to nobody. */
    it('refuses a buying tariff with no partner behind it', async () => {
      const state = await runImport(
        {},
        upload('rate-cards', sheet(RATE_HEADER, [rateRow('ocean_freight', '850.000')]), {
          branchId: HOME_BRANCH,
          intent: 'commit',
          direction: 'buy',
        }),
      )
      expect(state.error).toBe('no_partner')
    })

    /**
     * The flat sheet becomes one card and its lines. Two rows sharing lane,
     * currency and validity are one tariff with two charges on it, not two
     * tariffs — which is the whole of `groupRateCards`.
     */
    it('groups a flat sheet into one card with its lines beneath it', async () => {
      const lane = window()
      const state = await runImport(
        {},
        upload(
          'rate-cards',
          sheet(RATE_HEADER, [
            rateRow('ocean_freight', '850.000', { validity: lane }),
            rateRow('thc_origin', '120.000', { validity: lane }),
          ]),
          {
            branchId: HOME_BRANCH,
            intent: 'commit',
            direction: 'buy',
            partnerId: PARTNER,
          },
        ),
      )

      expect(state.committed?.cards).toBe(1)
      expect(state.committed?.records).toBe(2)
    })

    it('writes a selling tariff with no partner attached to it', async () => {
      const state = await runImport(
        {},
        upload('rate-cards', sheet(RATE_HEADER, [rateRow('documentation', '15.000', FLAT)]), {
          branchId: HOME_BRANCH,
          intent: 'commit',
          direction: 'sell',
        }),
      )

      expect(state.committed?.cards).toBe(1)

      const [card] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ id: rateCards.id, partnerId: rateCards.partnerId })
          .from(rateCards)
          .where(eq(rateCards.direction, 'sell'))
          .orderBy(sql`created_at desc`)
          .limit(1),
      )
      expect(card?.partnerId).toBeNull()

      const lines = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ basis: rateCardLines.basis, rate: rateCardLines.rate })
          .from(rateCardLines)
          .where(eq(rateCardLines.rateCardId, card!.id)),
      )
      expect(lines[0]?.basis).toBe('flat')
      expect(Number(lines[0]?.rate)).toBeCloseTo(15, 3)
    })

    it('refuses a lane the location table does not carry', async () => {
      const row = rateRow('ocean_freight', '850.000')
      row[1] = 'ZZZZZ'

      const state = await runImport(
        {},
        upload('rate-cards', sheet(RATE_HEADER, [row]), {
          branchId: HOME_BRANCH,
          direction: 'sell',
        }),
      )
      expect(state.ok).toBe(false)
      expect(state.issues?.[0]?.column).toBe('Origin')
    })

    it('refuses a charge the catalogue does not carry', async () => {
      const state = await runImport(
        {},
        upload('rate-cards', sheet(RATE_HEADER, [rateRow('made_up_charge', '10.000')]), {
          branchId: HOME_BRANCH,
          direction: 'sell',
        }),
      )
      expect(state.ok).toBe(false)
      expect(state.issues?.[0]?.column).toBe('Charge')
    })

    /**
     * A per-container rate with no equipment type cannot be applied to a
     * booking — there is nothing to multiply. Caught at validation rather than
     * left to produce a charge line of zero.
     */
    it('refuses a per-container rate with no equipment type', async () => {
      const state = await runImport(
        {},
        upload(
          'rate-cards',
          sheet(RATE_HEADER, [rateRow('ocean_freight', '850.000', { container: '' })]),
          { branchId: HOME_BRANCH, direction: 'sell' },
        ),
      )
      expect(state.ok).toBe(false)
      expect(state.issues?.[0]?.message).toContain('container type')
    })

    /** `per container` is what a tariff says; `per_container` is what we store. */
    it('reads the basis names a real tariff actually uses', async () => {
      const state = await runImport(
        {},
        upload(
          'rate-cards',
          sheet(RATE_HEADER, [rateRow('ocean_freight', '850.000', LUMP_SUM)]),
          { branchId: HOME_BRANCH, direction: 'sell' },
        ),
      )
      expect(state.ok).toBe(true)
    })

    /**
     * The database's own guard, surfaced as a sentence rather than a stack.
     *
     * `rate_cards_no_overlap` refuses a second tariff covering the same lane
     * over overlapping days, which is the shape of the mistake an operator
     * actually makes: re-importing a corrected sheet without superseding the
     * one already loaded. `writeError` maps the SQLSTATE to `conflict` so the
     * screen can say so.
     */
    it('refuses a second tariff overlapping one already on the lane', async () => {
      const lane = window()
      const commit = { branchId: HOME_BRANCH, intent: 'commit', direction: 'sell' }
      const file = () =>
        sheet(RATE_HEADER, [rateRow('ocean_freight', '850.000', { validity: lane })])

      const first = await runImport({}, upload('rate-cards', file(), commit))
      expect(first.committed?.cards).toBe(1)

      const again = await runImport({}, upload('rate-cards', file(), commit))
      expect(again.error).toBe('conflict')
      expect(again.committed).toBeUndefined()
    })
  })

  describe('the customer the fixtures own', () => {
    /** A guard on the fixture itself: the cutover sheets above lean on this code. */
    it('is reachable by the code the cutover sheets name', async () => {
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ code: customers.code }).from(customers).where(eq(customers.id, CUSTOMER)),
      )
      expect(row?.code).toBe('CUST-FIXTURE-HOME')
    })
  })
})
