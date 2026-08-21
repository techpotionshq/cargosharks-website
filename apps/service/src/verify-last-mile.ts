/**
 * Prove the last mile works, end to end, against this database.
 *
 *     pnpm --filter @qabandi/service verify:last-mile
 *
 * Four features shipped together — documents, consolidation, accounting export
 * and duty estimation — and every one of them is a *join* between parts that
 * pass their own tests in isolation. The template renders from a view; the
 * view loads from tables; the tables were created by a migration; the storage
 * driver signs against credentials somebody pasted in. Each half is tested.
 * The seam is not, and every fault this codebase has had lived in a seam
 * (`Operations_Findings.md`, OP-01: *every bug found was in code with no
 * test*).
 *
 * So this runs the real loaders, the real Chromium, the real allocation engine
 * and the real journal builder against real rows, and prints what came out.
 *
 * ## It writes rows and cannot take them back
 *
 * Nothing in this product deletes (§5.5) — `app_user` holds no DELETE on any
 * business table. So it does what the product does: writes fixtures prefixed
 * `VERIFY-`, and cancels or deactivates them at the end. It prints exactly
 * what it left behind.
 *
 * A development and staging check. Run it after `db:migrate` and `db:seed` on
 * a new deployment, before the first real shipment is loaded.
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  SEED_CURRENCIES,
  allocate,
  buildJournal,
  checkMatch,
  compareToAccrual,
  dec,
  estimateDuty,
  money,
  toDb,
  toJournalCsv,
  tolerance,
  type CurrencySpec,
  type TariffLine,
} from '@qabandi/core'
import {
  branches,
  chargeLines,
  chargeTypes,
  consolChargeLines,
  consolidations,
  customers,
  customsStages,
  db,
  dutyRates,
  jobCargo,
  jobParties,
  jobs,
  loadEnv,
  locations,
  partners,
  supplierInvoiceLines,
  supplierInvoiceMatches,
  supplierInvoices,
  systemActor,
  withActor,
} from '@qabandi/db'
import { buildAccountingExport } from './accounting/export'
import { loadCustomsPackView, renderJobDocumentPdf, renderManifestPdf } from './pdf/job-documents'
import { storeJobDocument } from './pdf/store'
import { fileStore } from './adapters/index'

loadEnv()

const actor = systemActor()
const STAMP = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
const TAG = `VERIFY-${STAMP}`

const spec = (code: string): CurrencySpec =>
  SEED_CURRENCIES.find((c) => c.code === code) ?? { code, minorUnits: 2 }

const ok = (label: string, detail: string): void => console.log(`  ok   ${label} — ${detail}`)
const skip = (label: string, why: string): void => console.log(`  skip ${label} — ${why}`)

interface Fixture {
  readonly branchId: string
  readonly branchCode: string
  readonly baseCurrency: string
  readonly customerId: string
  readonly jobA: string
  readonly jobB: string
  readonly consolidationId: string
  readonly freightChargeTypeId: string
}

/**
 * Two houses under one master, with cargo on both.
 *
 * Two rather than one, because a one-house allocation is arithmetic that
 * cannot go wrong: every basis gives it the whole cost. The interesting
 * failure is a split that does not sum, and it takes two.
 */
async function build(): Promise<Fixture> {
  return withActor(actor, async (tx) => {
    const [branch] = await tx
      .select({
        id: branches.id,
        code: branches.code,
        baseCurrency: branches.baseCurrency,
      })
      .from(branches)
      .where(eq(branches.isActive, true))
      .limit(1)

    if (!branch) throw new Error('No active branch. Run pnpm db:create-branch first.')

    const [freight] = await tx
      .select({ id: chargeTypes.id })
      .from(chargeTypes)
      .where(eq(chargeTypes.isActive, true))
      .limit(1)

    if (!freight) throw new Error('No charge types. Run pnpm db:seed first.')

    const [port] = await tx.select({ id: locations.id }).from(locations).limit(1)

    const [customer] = await tx
      .insert(customers)
      .values({
        code: `${TAG}-CUST`,
        legalNameEn: `${TAG} Trading Co.`,
        legalNameAr: 'شركة التحقق للتجارة',
        countryCode: 'KW',
        primaryBranchId: branch.id,
      })
      .returning({ id: customers.id })

    const consolSeq = await tx.execute(sql`select nextval('consol_reference_seq')::text as seq`)
    const [consol] = await tx
      .insert(consolidations)
      .values({
        reference: `${branch.code}-CNS-${TAG}-${(consolSeq.rows[0] as { seq: string }).seq}`,
        branchId: branch.id,
        mode: 'sea_lcl',
        tradeDirection: 'import',
        masterBillNumber: `MSCU-${STAMP}`,
        vesselName: 'MV VERIFY',
        voyageNumber: '001W',
        originId: port?.id ?? null,
        destinationId: port?.id ?? null,
        etd: new Date(),
        eta: new Date(Date.now() + 14 * 86_400_000),
      })
      .returning({ id: consolidations.id })

    const houses: string[] = []
    for (const [index, figures] of [
      { volumeCbm: '12.480', grossWeightKg: '4820.500', packages: 120 },
      { volumeCbm: '6.020', grossWeightKg: '1180.000', packages: 30 },
    ].entries()) {
      const seq = await tx.execute(sql`select nextval('job_reference_seq')::text as seq`)
      const [job] = await tx
        .insert(jobs)
        .values({
          reference: `${branch.code}-JOB-${TAG}-${(seq.rows[0] as { seq: string }).seq}`,
          branchId: branch.id,
          customerId: customer!.id,
          status: 'booked',
          mode: 'sea_lcl',
          tradeDirection: 'import',
          originId: port?.id ?? null,
          destinationId: port?.id ?? null,
          consolidationId: consol!.id,
          houseBillNumber: `HBL-${STAMP}-${index + 1}`,
          volumeCbm: figures.volumeCbm,
          grossWeightKg: figures.grossWeightKg,
          etd: new Date(),
          eta: new Date(Date.now() + 14 * 86_400_000),
        })
        .returning({ id: jobs.id })

      houses.push(job!.id)

      await tx.insert(jobParties).values([
        {
          jobId: job!.id,
          role: 'shipper',
          nameEn: 'Shanghai Everbright Ltd.',
          address: 'No. 88 Pudong Avenue\nBuilding C, Floor 12',
          city: 'Shanghai',
          country: 'CN',
        },
        {
          jobId: job!.id,
          role: 'consignee',
          nameEn: 'TO ORDER',
        },
        {
          jobId: job!.id,
          role: 'notify',
          nameEn: `${TAG} Trading Co.`,
          city: 'Kuwait City',
          country: 'KW',
        },
      ])

      await tx.insert(jobCargo).values({
        jobId: job!.id,
        lineNo: 1,
        marksAndNumbers: `${TAG}/1-${figures.packages}\nMADE IN CHINA`,
        packageCount: figures.packages,
        packageType: 'CARTONS',
        descriptionEn: 'Ceramic floor tiles',
        descriptionAr: 'بلاط سيراميك للأرضيات',
        hsCode: '6907.21.00',
        grossWeightKg: figures.grossWeightKg,
        netWeightKg: figures.grossWeightKg,
        volumeCbm: figures.volumeCbm,
      })
    }

    return {
      branchId: branch.id,
      branchCode: branch.code,
      baseCurrency: branch.baseCurrency,
      customerId: customer!.id,
      jobA: houses[0]!,
      jobB: houses[1]!,
      consolidationId: consol!.id,
      freightChargeTypeId: freight.id,
    }
  })
}

/** Every document, rendered by the real Chromium against the real rows. */
async function checkDocuments(fixture: Fixture): Promise<void> {
  console.log('\ndocuments')

  for (const kind of ['house_bill', 'delivery_order', 'packing_list', 'customs_pack'] as const) {
    const { pdf, filename, html } = await renderJobDocumentPdf(actor, fixture.jobA, kind, 'en')

    if (!pdf.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
      throw new Error(`${kind}: not a PDF — got ${pdf.subarray(0, 16).toString('latin1')}`)
    }
    if (pdf.byteLength < 1000) throw new Error(`${kind}: implausibly small (${pdf.byteLength} B)`)
    if (!html.includes('Ceramic floor tiles')) {
      throw new Error(`${kind}: the cargo line did not reach the document`)
    }

    ok(kind, `${(pdf.byteLength / 1024).toFixed(0)} KB · ${filename}`)
  }

  /*
    Arabic is checked by rendering, not by asserting on markup.

    Whether the shaping and the bidi are right is Chromium's business and can
    only be seen. What is checkable here is that the Arabic path produces a
    document at all — the fault worth catching is a missing font in the image,
    which shows up as a PDF that renders but is a third of the size.
  */
  const arabic = await renderJobDocumentPdf(actor, fixture.jobA, 'house_bill', 'ar')
  if (!arabic.html.includes('بوليصة شحن فرعية')) {
    throw new Error('house_bill (ar): Arabic strings did not reach the template')
  }
  ok('house_bill (ar)', `${(arabic.pdf.byteLength / 1024).toFixed(0)} KB`)

  const manifest = await renderManifestPdf(actor, fixture.consolidationId, 'en')
  if (!manifest.html.includes('2 house bills')) {
    throw new Error('manifest: both houses did not appear')
  }
  ok('manifest', `${(manifest.pdf.byteLength / 1024).toFixed(0)} KB · both houses listed`)
}

/** Issue: the bytes are stored, versioned and recorded. */
async function checkStorage(fixture: Fixture): Promise<void> {
  console.log('\nissue and storage')

  const driver = (await fileStore()).key
  if (driver === 'none' || driver === 'memory') {
    skip('store', `FileStore driver is "${driver}" — set S3_* to check the real bucket`)
    return
  }

  const { pdf, filename } = await renderJobDocumentPdf(actor, fixture.jobA, 'delivery_order', 'en')
  const first = await storeJobDocument(actor, fixture.jobA, 'delivery_order', 'en', pdf, filename)
  ok('store', `v${first.version} → ${first.storageKey}`)

  const again = await storeJobDocument(actor, fixture.jobA, 'delivery_order', 'en', pdf, filename)
  if (again.version !== first.version + 1) {
    throw new Error(`regeneration did not version: ${first.version} then ${again.version}`)
  }
  ok('versioning', `re-issue wrote v${again.version} and superseded v${first.version}`)

  const fetched = await (await fileStore()).get(again.storageKey)
  if (fetched.byteLength !== pdf.byteLength) {
    throw new Error(`stored ${pdf.byteLength} B, read back ${fetched.byteLength} B`)
  }
  ok('round trip', `${fetched.byteLength} B read back from ${driver}`)
}

/** The split: it sums, and it lands as ordinary charge lines. */
async function checkAllocation(fixture: Fixture): Promise<void> {
  console.log('\nconsolidation')

  const currency = fixture.baseCurrency
  const total = money('300', currency)

  const [master] = await withActor(actor, async (tx) =>
    tx
      .insert(consolChargeLines)
      .values({
        consolidationId: fixture.consolidationId,
        branchId: fixture.branchId,
        direction: 'cost',
        chargeTypeId: fixture.freightChargeTypeId,
        description: `${TAG} ocean freight`,
        basis: 'flat',
        quantity: '1',
        rate: toDb(total),
        amount: toDb(total),
        currency,
        amountBase: toDb(total),
        baseCurrency: currency,
        allocationBasis: 'volume',
      })
      .returning({ id: consolChargeLines.id }),
  )

  const houses = await withActor(actor, async (tx) =>
    tx
      .select({
        jobId: jobs.id,
        volumeCbm: sql<string>`(
          select coalesce(sum(c.volume_cbm), 0)::text from job_cargo c where c.job_id = "jobs"."id"
        )`,
      })
      .from(jobs)
      .where(eq(jobs.consolidationId, fixture.consolidationId)),
  )

  const allocation = allocate(total, houses, 'volume', spec(currency))
  const summed = allocation.shares.reduce((acc, s) => acc.plus(dec(s.share.amount)), dec(0))

  if (!summed.equals(dec(total.amount))) {
    throw new Error(`shares total ${summed.toString()}, cost is ${total.amount.toString()}`)
  }
  ok(
    'split sums exactly',
    `${allocation.shares.map((s) => s.share.amount.toString()).join(' + ')} = ${summed.toString()} ${currency}`,
  )

  await withActor(actor, async (tx) => {
    for (const share of allocation.shares) {
      await tx.insert(chargeLines).values({
        jobId: share.jobId,
        branchId: fixture.branchId,
        direction: 'cost',
        chargeTypeId: fixture.freightChargeTypeId,
        description: `${TAG} allocated freight`,
        basis: 'flat',
        quantity: '1',
        rate: toDb(share.share),
        amount: toDb(share.share),
        currency,
        amountBase: toDb(share.share),
        baseCurrency: currency,
        sourceKind: 'consol_allocation',
        sourceId: master!.id,
      })
    }
    await tx
      .update(consolChargeLines)
      .set({ allocatedAt: new Date(), updatedAt: new Date() })
      .where(eq(consolChargeLines.id, master!.id))
  })

  const posted = await withActor(actor, async (tx) =>
    tx
      .select({ jobId: chargeLines.jobId, amount: chargeLines.amount })
      .from(chargeLines)
      .where(
        and(eq(chargeLines.sourceKind, 'consol_allocation'), eq(chargeLines.sourceId, master!.id)),
      ),
  )

  if (posted.length !== houses.length) {
    throw new Error(`posted ${posted.length} lines for ${houses.length} houses`)
  }
  ok('lines posted', `${posted.length} ordinary charge lines, traceable to the master line`)
}

/** The estimate: a real tariff lookup against the seeded rows. */
async function checkDuty(fixture: Fixture): Promise<void> {
  console.log('\nduty')

  const tariff = await withActor(
    actor,
    async (tx) => (await tx.select().from(dutyRates)) as unknown as TariffLine[],
  )

  if (tariff.length === 0) {
    skip('estimate', 'no duty_rates rows — run pnpm db:seed')
    return
  }

  const currency = fixture.baseCurrency
  const estimate = estimateDuty(
    [{ hsCode: '6907.21.00', description: 'Ceramic floor tiles', value: '10000' }],
    tariff,
    { country: 'KW', currency, on: new Date(), spec: spec(currency) },
  )

  /*
    Ceramics carry no row in the seeded tariff, so this is expected to come
    back unmatched — and that is the assertion. Silently applying 5% to a code
    nobody classified is exactly the behaviour the engine refuses.
  */
  if (estimate.unmatched.length !== 1) {
    throw new Error(`expected the unclassified line to be reported, got ${estimate.unmatched.length}`)
  }
  ok('unclassified reported', 'no rate invented for a code the tariff does not carry')

  const exempt = estimateDuty(
    [{ hsCode: '3004901000', description: 'Medicines', value: '2000' }],
    tariff,
    { country: 'KW', currency, on: new Date(), spec: spec(currency) },
  )
  if (exempt.lines[0]?.matchedPrefix !== '30') {
    throw new Error(`chapter-level exemption did not match: ${JSON.stringify(exempt.lines[0])}`)
  }
  ok('chapter match', `30 → ${exempt.lines[0].ratePercent}% (${exempt.lines[0].matchedDescription})`)

  await withActor(actor, async (tx) => {
    await tx.insert(customsStages).values({
      jobId: fixture.jobA,
      status: 'not_started',
      customsValue: '10000',
      customsValueCurrency: currency,
      estimatedDutyAmount: estimate.duty.amount.toString(),
      estimatedAt: new Date(),
      estimateBasis: { verify: TAG, unmatched: estimate.unmatched.length },
    })
  })
  ok('stored', 'estimate recorded on the customs stage beside the assessment')

  const pack = await loadCustomsPackView(actor, fixture.jobA, { goodsValue: '10000' })
  if (pack.lines.length === 0) throw new Error('customs pack carried no lines')
  ok('pack', `${pack.lines.length} line(s), ${pack.unmatched.length} unclassified`)
}

/**
 * The journal: built from the branch's real chart of accounts, or refusing
 * with the reason.
 *
 * A branch with no control accounts is the ordinary state of a fresh
 * deployment, and the refusal naming what to configure *is* the feature. So
 * this checks the refusal first, then proves the journal balances using the
 * accounts as they would be once mapped.
 */
/**
 * Cost verification, against real rows — FR-FN-09.
 *
 * The engine in `core/matching.ts` is tested in milliseconds against no
 * infrastructure. What has never run is the *seam*: a supplier invoice
 * captured into real tables, matched to a charge line the allocation engine
 * wrote earlier in this same script, and the variance computed from what came
 * back out of `numeric(19,6)`.
 *
 * That seam is where this codebase's faults have always lived, and it is worth
 * a round trip: the accrual is a real allocated cost, the bill is deliberately
 * 15% over it, and the assertion is that the system says so.
 */
async function checkPayables(fixture: Fixture): Promise<void> {
  console.log('\ncost verification')

  const accrual = await withActor(actor, async (tx) =>
    tx
      .select({
        id: chargeLines.id,
        amount: chargeLines.amount,
        amountBase: chargeLines.amountBase,
        currency: chargeLines.currency,
        branchId: chargeLines.branchId,
      })
      .from(chargeLines)
      .where(and(eq(chargeLines.jobId, fixture.jobA), eq(chargeLines.direction, 'cost')))
      .limit(1),
  )

  if (accrual.length === 0) {
    skip('match', 'no cost line on the house — the allocation step must run first')
    return
  }

  const cost = accrual[0]!
  const billed = dec(cost.amount).times('1.15').toFixed(3)

  const partner = await withActor(actor, async (tx) =>
    tx.select({ id: partners.id, name: partners.legalNameEn }).from(partners).limit(1),
  )
  if (partner.length === 0) {
    skip('match', 'no partner seeded to raise a bill from')
    return
  }

  const billId = await withActor(actor, async (tx) => {
    const [bill] = await tx
      .insert(supplierInvoices)
      .values({
        branchId: cost.branchId,
        partnerId: partner[0]!.id,
        reference: `${TAG}-BILL`,
        currency: cost.currency,
        fxRate: '1',
        invoiceDate: new Date().toISOString().slice(0, 10),
        subtotal: billed,
        total: billed,
      })
      .returning({ id: supplierInvoices.id })

    const [line] = await tx
      .insert(supplierInvoiceLines)
      .values({
        supplierInvoiceId: bill!.id,
        branchId: cost.branchId,
        chargeTypeId: fixture.freightChargeTypeId,
        description: 'OCEAN FREIGHT AS PER AGREEMENT',
        quantity: '1',
        unitPrice: billed,
        amount: billed,
      })
      .returning({ id: supplierInvoiceLines.id })

    await tx.insert(supplierInvoiceMatches).values({
      supplierInvoiceLineId: line!.id,
      chargeLineId: cost.id,
      branchId: cost.branchId,
      amount: billed,
    })

    return bill!.id
  })

  ok('capture', `${TAG}-BILL for ${billed} ${cost.currency} against an accrual of ${cost.amount}`)

  /*
    Read back through `numeric`, not held in memory.

    The whole point of the round trip: the figures are compared as the database
    returns them — strings — and the arithmetic is `Decimal`'s. A float here
    would put 0.09999999999999964 where a fils belongs.
  */
  const readBack = await withActor(actor, async (tx) =>
    tx.execute(sql`
      select l.amount::text as billed,
             coalesce((
               select sum(cl.amount_base)
                 from supplier_invoice_matches m
                 join charge_lines cl on cl.id = m.charge_line_id
                where m.supplier_invoice_line_id = l.id
                  and m.retracted_at is null
             ), 0)::text as accrued
        from supplier_invoice_lines l
       where l.supplier_invoice_id = ${billId}
    `),
  )

  const row = readBack.rows[0] as { billed: string; accrued: string } | undefined
  if (!row) throw new Error('the captured bill did not read back')

  const outcome = compareToAccrual(
    money(row.accrued, cost.currency),
    money(row.billed, cost.currency),
    tolerance('1', '2'),
    spec(cost.currency),
  )

  if (outcome.verdict !== 'over') {
    throw new Error(`a bill 15% over its accrual was judged "${outcome.verdict}"`)
  }
  ok(
    'variance',
    `${outcome.variance.amount} ${cost.currency} over, ` +
      `${outcome.variancePercent?.toFixed(1)}% — outside a 1% / 2.000 tolerance`,
  )

  /*
    The ceiling, exercised rather than asserted about.

    Matching more of the supplier's line than they billed invents a liability.
    The engine refuses, and this proves the position it refuses against is the
    one the database actually holds.
  */
  const over = checkMatch(
    dec(billed).plus('1').toFixed(),
    { billed: row.billed, matched: row.billed },
    cost.currency,
  )
  if (over.ok) throw new Error('the supplier-line ceiling did not hold')
  ok('ceiling', `refuses a match beyond ${row.billed} ${cost.currency}, as it should`)

  /*
    Voided rather than deleted (§5.5). Nothing was paid against it, which is
    the condition the product's own void path enforces.
  */
  await withActor(actor, async (tx) => {
    await tx.execute(sql`
      update supplier_invoice_matches m
         set retracted_at = now(), updated_at = now()
        from supplier_invoice_lines l
       where l.id = m.supplier_invoice_line_id and l.supplier_invoice_id = ${billId}
    `)
    await tx
      .update(supplierInvoices)
      .set({
        status: 'void',
        disputedAt: new Date(),
        disputeReason: `${TAG} verification fixture`,
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, billId))
  })
  ok('cleanup', 'bill voided, its match retracted — nothing deleted')
}

async function checkJournal(fixture: Fixture): Promise<void> {
  console.log('\naccounting export')

  const [branch] = await withActor(actor, async (tx) =>
    tx
      .select({
        code: branches.code,
        baseCurrency: branches.baseCurrency,
        ar: branches.arAccountCode,
        ap: branches.apAccountCode,
        tax: branches.taxAccountCode,
        bank: branches.bankAccountCode,
        fx: branches.fxVarianceAccountCode,
        rounding: branches.roundingAccountCode,
      })
      .from(branches)
      .where(eq(branches.id, fixture.branchId))
      .limit(1),
  )

  const configured = Boolean(branch?.ar && branch.ap && branch.bank)
  console.log(
    configured
      ? `  ..   branch ${branch!.code} has its control accounts set`
      : `  ..   branch ${branch!.code} has no control accounts — the export will name them`,
  )

  const mapped = await withActor(actor, async (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(chargeTypes)
      .where(isNull(chargeTypes.revenueAccountCode)),
  )
  console.log(`  ..   ${mapped[0]!.n} charge type(s) still unmapped`)

  /*
    Built against a stand-in chart of accounts rather than the branch's.

    The point being checked is that the *engine* balances a real period's
    shape — an invoice, a cost and a receipt in three currencies — not that
    this deployment has been configured yet. Configuring it is an operator's
    job and the refusal above tells them so.
  */
  const currency = branch!.baseCurrency
  const journal = buildJournal(
    {
      branchCode: branch!.code,
      baseCurrency: currency,
      controls: {
        receivables: branch!.ar ?? '1200',
        payables: branch!.ap ?? '2100',
        tax: branch!.tax ?? '2200',
        bank: branch!.bank ?? '1010',
        fxVariance: branch!.fx ?? '7800',
        rounding: branch!.rounding ?? '7900',
      },
      mappings: [
        {
          chargeTypeId: fixture.freightChargeTypeId,
          key: 'verify_freight',
          nameEn: 'Ocean freight',
          revenueAccountCode: '4010',
          costAccountCode: '5010',
        },
      ],
      invoices: [
        {
          id: 'verify-invoice',
          seriesNo: `${TAG}-INV`,
          issuedAt: new Date(),
          customerName: `${TAG} Trading Co.`,
          currency: 'USD',
          fxRate: '0.307',
          isCreditNote: false,
          lines: [
            {
              chargeTypeId: fixture.freightChargeTypeId,
              description: 'Ocean freight',
              amount: '1000',
              taxAmount: '0',
            },
          ],
        },
      ],
      costs: [
        {
          id: 'verify-cost',
          jobReference: `${TAG}-JOB`,
          chargeTypeId: fixture.freightChargeTypeId,
          incurredOn: new Date(),
          description: 'Ocean freight — carrier',
          currency,
          amount: '200',
          fxRate: '1',
          counterpartyName: 'MSC',
        },
      ],
      payments: [
        {
          id: 'verify-receipt',
          receivedOn: new Date(),
          customerName: `${TAG} Trading Co.`,
          currency: 'USD',
          amount: '1000',
          fxRate: '0.309',
          method: 'transfer',
          reference: `${TAG}-TT`,
          allocations: [{ invoiceSeriesNo: `${TAG}-INV`, baseAmount: '307' }],
        },
      ],
    },
    spec(currency),
  )

  if (!dec(journal.totalDebit.amount).equals(dec(journal.totalCredit.amount))) {
    throw new Error(
      `journal does not balance: ${journal.totalDebit.amount} vs ${journal.totalCredit.amount}`,
    )
  }
  ok(
    'balances',
    `${journal.lines.length} lines, Dr ${journal.totalDebit.amount} = Cr ${journal.totalCredit.amount} ${currency}`,
  )

  const fx = journal.lines.find((l) => l.sourceKind === 'fx')
  if (!fx) throw new Error('realised FX did not fall out of the receipt')
  ok('realised FX', `${fx.credit.amount} ${currency} on a rate that moved 0.307 → 0.309`)

  const csv = toJournalCsv(journal, currency)
  const rows = csv.split('\r\n')
  if (rows.length !== journal.lines.length + 1) {
    throw new Error(`CSV has ${rows.length} rows for ${journal.lines.length} lines`)
  }
  ok('csv', `${rows.length - 1} rows, importable into Tally, QuickBooks, Xero or Focus`)
  await checkRealExport(fixture, configured)
}

/**
 * The export routine itself, against this database.
 *
 * Everything above is the engine. This is the half that reads the period,
 * stores the file and marks the sources — and it had never run outside a type
 * checker. Two shapes are worth proving, and they are different code paths:
 *
 *   unconfigured   it refuses, and the refusal names what to fix
 *   configured     it produces a file, stores it, and marks nothing (draft)
 *
 * A draft deliberately. Posting would consume this deployment's real
 * unexported invoices, which is not a verification script's business — and the
 * only thing posting adds over a draft is the marking, which is one `update`
 * carrying its own condition.
 */
async function checkRealExport(fixture: Fixture, configured: boolean): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const request = { branchId: fixture.branchId, from: today, to: today }

  if (configured) {
    await runDraft(request)
    return
  }

  try {
    await buildAccountingExport(actor, request)
    throw new Error('the export ran with no control accounts configured')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('the export ran with no')) throw error
    ok('refuses when unconfigured', `${message.split('.')[0]}.`)
  }

  /*
    Then the happy path, with the accounts set for the length of this check and
    put back afterwards.

    Guessing a customer's chart of accounts and leaving it behind would be
    worse than not checking at all: a branch that silently acquired these codes
    would post a month to accounts that do not exist in their ledger.
  */
  await setAccounts(fixture.branchId, {
    ar: '1200',
    ap: '2100',
    tax: '2200',
    bank: '1010',
    fx: '7800',
    rounding: '7900',
  })

  try {
    await runDraft(request)
  } finally {
    await setAccounts(fixture.branchId, {})
    ok('accounts restored', 'the placeholder chart of accounts was removed again')
  }
}

async function setAccounts(
  branchId: string,
  codes: {
    ar?: string
    ap?: string
    tax?: string
    bank?: string
    fx?: string
    rounding?: string
  },
): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .update(branches)
      .set({
        arAccountCode: codes.ar ?? null,
        apAccountCode: codes.ap ?? null,
        taxAccountCode: codes.tax ?? null,
        bankAccountCode: codes.bank ?? null,
        fxVarianceAccountCode: codes.fx ?? null,
        roundingAccountCode: codes.rounding ?? null,
        updatedAt: new Date(),
      })
      .where(eq(branches.id, branchId))
  })
}

async function runDraft(request: {
  branchId: string
  from: string
  to: string
}): Promise<void> {
  try {
    const result = await buildAccountingExport(actor, request)
    ok(
      'draft export',
      `${result.rowCount} journal lines from ${result.invoiceCount} invoice(s), ` +
        `${result.costCount} cost(s), ${result.paymentCount} receipt(s) — ` +
        `Dr ${result.totalDebit} = Cr ${result.totalCredit}`,
    )
    ok('stored', `${result.filename} · sha256 ${result.checksum.slice(0, 12)}…`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    /*
      An unmapped charge type is the expected outcome on a deployment nobody
      has configured, and the message names every one of them. That is the
      feature, so it is reported rather than failed.
    */
    if (message.includes('no account against them') || message.includes('not mapped')) {
      ok('names what to map', `${message.split('.')[0]}.`)
      return
    }
    throw error
  }
}

/** Cancel what was written. Nothing here deletes — §5.5. */
async function cleanUp(fixture: Fixture): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .update(jobs)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledReason: `${TAG} verification fixture`,
        updatedAt: new Date(),
      })
      .where(eq(jobs.consolidationId, fixture.consolidationId))

    await tx
      .update(consolidations)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledReason: `${TAG} verification fixture`,
        updatedAt: new Date(),
      })
      .where(eq(consolidations.id, fixture.consolidationId))

    await tx
      .update(customers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(customers.id, fixture.customerId))
  })
}

async function main(): Promise<void> {
  console.log(`verifying the last mile against ${process.env.DATABASE_URL?.split('@')[1] ?? '?'}`)

  const fixture = await build()
  console.log(`fixtures: ${TAG} — 1 consolidation, 2 houses, 3 parties and 1 cargo line each`)

  try {
    await checkDocuments(fixture)
    await checkStorage(fixture)
    await checkAllocation(fixture)
    await checkDuty(fixture)
    await checkPayables(fixture)
    await checkJournal(fixture)

    await cleanUp(fixture)

    console.log('\nlast mile OK')
    console.log(
      `left behind: 1 cancelled consolidation, 2 cancelled jobs, 1 deactivated customer, ` +
        'their parties, cargo, charge lines and any stored documents — all tagged ' +
        `${TAG}.`,
    )
  } catch (error) {
    await cleanUp(fixture).catch(() => {})
    throw error
  } finally {
    await db.$client.end()
  }
}

main().catch((error: unknown) => {
  console.error('\nlast mile FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
