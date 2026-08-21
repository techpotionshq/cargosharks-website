/**
 * Prove the model provider works against the account this deployment is billed to.
 *
 *     pnpm --filter @qabandi/service verify:model
 *
 * The unit tests pin the request shape and every response shape against a
 * stubbed `fetch`, which is what makes them worth running in CI — but they
 * cannot tell you that a key has credit, that a slug exists, that the model
 * behind it accepts a PDF, or that it honours strict structured output. Only a
 * real call does, and `Operations_Findings.md` records what it costs to skip
 * that step: *"two integrations were written against documentation and both
 * were wrong in ways that testing caught immediately."*
 *
 * The PDF path in `adapters/model.ts` is carried in this repository as
 * **Documented, not Verified**. This script is how that tag gets removed.
 *
 * Three calls, in ascending order of what they prove:
 *
 *   1. plain text        the key is live, the slug resolves, cost is reported
 *   2. structured output the schema is honoured, not merely acknowledged
 *   3. a real PDF        the `file` part is accepted, and what it read is right
 *
 * The third generates a supplier invoice whose figures deliberately balance,
 * so the answer can be checked by `reconcileInvoice` rather than by eye — the
 * same arithmetic the product uses to decide whether an extraction is
 * trustworthy at all.
 *
 * It reads the environment directly rather than going through `config.ts`,
 * which insists on a `DATABASE_URL` and an `INTERNAL_API_SECRET` first. That
 * insistence is right for the service and wrong here: checking a model key
 * should not require a database, and somebody who has just pasted one in
 * should be able to test *that*.
 */

import { loadEnv } from '@qabandi/db'
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_PRICING,
  costOf,
  describeFinding,
  parseModelJson,
  readExtractedInvoice,
  reconcileInvoice,
  seedCurrencyLookup,
  toDb,
  INVOICE_EXTRACTION_SCHEMA,
} from '@qabandi/core'
import type { ImportLookups } from '@qabandi/core/import'
import { toolsFor, allPermissionKeys } from '@qabandi/core'
import { openRouterModel } from './model'
import { INVOICE_USER_PROMPT, assistantSystemPrompt, invoiceSystemPrompt } from '../ai/prompts'

/** The invoice the generated PDF prints. It balances: 2 × 450 + 15 = 915. */
const INVOICE = {
  number: 'AGT-2026-1187',
  date: '2026-08-14',
  currency: 'KWD',
  lines: [
    {
      description: 'Ocean freight Jebel Ali to Shuwaikh',
      qty: '2',
      unit: '450.000',
      amount: '900.000',
    },
    { description: 'Documentation fee', qty: '1', unit: '15.000', amount: '15.000' },
  ],
  total: '915.000',
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/**
 * A minimal single-page PDF, built here rather than committed as a fixture.
 *
 * Committing a binary would make this script depend on a file somebody has to
 * keep in step with the figures above, and the whole point is that the figures
 * and the assertion are the same source. Everything below is the PDF format's
 * own scaffolding; the only interesting part is `lines`.
 */
function invoicePdf(): Buffer {
  const rows = [
    'AL MADINA SHIPPING AGENCY W.L.L.',
    'Dubai, United Arab Emirates',
    '',
    `INVOICE  ${INVOICE.number}`,
    `Date: ${INVOICE.date}`,
    `Currency: ${INVOICE.currency}`,
    '',
    'Description                          Qty     Unit      Amount',
    ...INVOICE.lines.map(
      (line) =>
        `${line.description.padEnd(36)} ${line.qty.padEnd(7)} ${line.unit.padEnd(9)} ${line.amount}`,
    ),
    '',
    `Subtotal: ${INVOICE.total}`,
    'VAT: 0.000',
    `TOTAL DUE: ${INVOICE.total}`,
  ]

  // `(` and `)` delimit a PDF string; an unescaped one in the text breaks it.
  const escape = (text: string): string => text.replace(/([()\\])/g, '\\$1')
  const stream = [
    'BT',
    '/F1 11 Tf',
    '14 TL',
    '40 760 Td',
    ...rows.map((row) => `(${escape(row)}) Tj T*`),
    'ET',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

const tick = '  ok  '
const cross = ' FAIL '

async function main(): Promise<void> {
  loadEnv()

  const model = process.env.AI_MODEL || DEFAULT_MODEL
  const provider = openRouterModel({
    apiKey: required('OPENROUTER_API_KEY'),
    baseUrl: 'https://openrouter.ai/api/v1',
    model,
    timeoutMs: 120_000,
    appUrl: process.env.WEB_URL ?? 'http://localhost:3000',
    appTitle: 'Qabandi verify',
  })

  console.log('')
  console.log(`Qabandi — model provider check`)
  console.log(`  driver ${provider.key}`)
  console.log('')

  let failures = 0
  const spent: string[] = []

  const report = (label: string, ok: boolean, detail?: string): void => {
    if (!ok) failures++
    console.log(`${ok ? tick : cross} ${label}`)
    if (detail) console.log(`       ${detail}`)
  }

  /* --- 1. the key is live ------------------------------------------------ */

  const hello = await provider.complete({
    surface: 'assistant',
    messages: [{ role: 'user', content: 'Reply with exactly: READY' }],
    maxOutputTokens: 32,
  })

  report(
    'key and slug resolve',
    hello.text.toUpperCase().includes('READY'),
    `served ${hello.model}, ${hello.inputTokens}+${hello.outputTokens} tokens, finish ${hello.finishReason}`,
  )
  report(
    'the provider reports what the call cost',
    hello.costUsd !== undefined,
    hello.costUsd !== undefined
      ? `${hello.costUsd} USD reported`
      : `not reported — costs will fall back to the table (${DEFAULT_MODEL_PRICING.inputPerMillionUsd}/${DEFAULT_MODEL_PRICING.outputPerMillionUsd} per million)`,
  )
  if (hello.costUsd) spent.push(hello.costUsd)

  /* --- 2. structured output is honoured ---------------------------------- */

  const structured = await provider.complete({
    surface: 'assistant',
    messages: [
      { role: 'user', content: 'The port of Shuwaikh is in Kuwait. Answer with the schema.' },
    ],
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['port', 'country'],
      properties: { port: { type: 'string' }, country: { type: 'string' } },
    },
    maxOutputTokens: 200,
  })

  try {
    const parsed = parseModelJson<{ port: string; country: string }>(structured.text)
    report(
      'structured output comes back as the schema',
      typeof parsed.port === 'string' && /kuwait/i.test(parsed.country),
      JSON.stringify(parsed),
    )
  } catch (error) {
    report('structured output comes back as the schema', false, String(error))
    console.log('       raw:', JSON.stringify(structured.raw).slice(0, 1200))
  }
  if (structured.costUsd) spent.push(structured.costUsd)

  /* --- 3. a real PDF ------------------------------------------------------ */

  const pdf = invoicePdf()
  console.log('')
  console.log(`  reading a generated ${pdf.byteLength}-byte supplier invoice…`)

  const extraction = await provider.complete({
    surface: 'invoice_extract',
    messages: [
      { role: 'system', content: invoiceSystemPrompt(['ocean_freight', 'documentation']) },
      {
        role: 'user',
        content: [
          { type: 'text', text: INVOICE_USER_PROMPT },
          {
            type: 'document',
            dataUri: `data:application/pdf;base64,${pdf.toString('base64')}`,
            filename: `${INVOICE.number}.pdf`,
          },
        ],
      },
    ],
    schema: INVOICE_EXTRACTION_SCHEMA,
    maxOutputTokens: 2_000,
  })

  if (extraction.costUsd) spent.push(extraction.costUsd)

  const lookups: ImportLookups = {
    currencies: new Set(['KWD', 'USD', 'AED']),
    chargeTypes: new Set(['OCEAN_FREIGHT', 'DOCUMENTATION']),
  }

  const extracted = readExtractedInvoice(parseModelJson(extraction.text), lookups)
  const spec = seedCurrencyLookup(extracted.header.currency || 'KWD')!
  const findings = reconcileInvoice(extracted, spec)

  report(
    'the PDF was accepted and read',
    extracted.lines.rows.length > 0,
    `${extracted.lines.rows.length} line(s), confidence ${extracted.confidence}`,
  )
  report(
    'the invoice number is right',
    extracted.header.invoiceNumber === INVOICE.number,
    `read "${extracted.header.invoiceNumber}", expected "${INVOICE.number}"`,
  )
  report(
    'the total is right',
    extracted.header.total === INVOICE.total || extracted.header.subtotal === INVOICE.total,
    `read total "${extracted.header.total}", subtotal "${extracted.header.subtotal}"`,
  )
  report(
    'the figures reconcile',
    findings.length === 0,
    findings.length === 0
      ? 'every line and total adds up'
      : findings.map(describeFinding).join('; '),
  )
  report(
    'no parsing issues',
    extracted.headerIssues.length === 0 && extracted.lines.ok,
    [
      ...extracted.headerIssues,
      ...extracted.lines.issues.map((i) => `line ${i.line}: ${i.message}`),
    ].join('; ') || 'clean',
  )

  console.log('')
  for (const row of extracted.lines.rows) {
    const values = row.values
    console.log(
      `       ${values.description} | qty ${values.quantity} | unit ${values.unitPrice ?? '—'} | ${values.amount} | ${values.chargeType ?? 'unclassified'}`,
    )
  }

  /* --- 4. tool calling ---------------------------------------------------- */

  /*
    The assistant is dead without this, and not every model does it well.

    Checked with the *real* tool declarations rather than a toy one, because
    what usually breaks is not tool calling in principle — it is a model that
    cannot choose between eight similar tools, or that invents an argument the
    schema forbids. Nothing is executed: this asks only whether the right tool
    is reached for, with arguments our own parsers would accept.
  */
  const tooled = await provider.complete({
    surface: 'assistant',
    messages: [
      { role: 'system', content: assistantSystemPrompt('en') },
      { role: 'user', content: 'Which of our invoices are overdue?' },
    ],
    tools: toolsFor(new Set(allPermissionKeys())).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    maxOutputTokens: 500,
  })

  if (tooled.costUsd) spent.push(tooled.costUsd)

  const called = tooled.toolCalls[0]
  report(
    'the model reaches for a tool rather than answering from nothing',
    tooled.toolCalls.length > 0,
    called
      ? `asked for ${called.name}(${called.arguments})`
      : `answered "${tooled.text.slice(0, 80)}"`,
  )
  report(
    'it picks the right tool for the question',
    called?.name === 'list_overdue_invoices',
    called ? `chose ${called.name}` : 'chose nothing',
  )

  if (called) {
    let args: unknown
    try {
      args = JSON.parse(called.arguments || '{}')
    } catch {
      args = undefined
    }
    report(
      'its arguments are valid JSON and name no branch',
      typeof args === 'object' &&
        args !== null &&
        !Object.keys(args as object).some((key) => /branch/i.test(key)),
      JSON.stringify(args),
    )
  }

  /* --- what it cost ------------------------------------------------------- */

  console.log('')
  if (spent.length > 0) {
    const total = spent.reduce((running, value) => running + Number(value), 0)
    console.log(`  four calls cost ${total.toFixed(6)} USD as reported by the provider.`)
  } else {
    const estimate = costOf(
      {
        inputTokens:
          hello.inputTokens + structured.inputTokens + extraction.inputTokens + tooled.inputTokens,
        outputTokens:
          hello.outputTokens +
          structured.outputTokens +
          extraction.outputTokens +
          tooled.outputTokens,
      },
      DEFAULT_MODEL_PRICING,
    )
    console.log(`  four calls cost about ${toDb(estimate)} USD, estimated from the table.`)
  }

  console.log('')
  console.log(failures === 0 ? 'Verified.' : `${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error: unknown) => {
  console.error('')
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error)
  process.exit(1)
})
