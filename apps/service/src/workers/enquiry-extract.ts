/**
 * Reading an emailed enquiry into its twelve null columns — FR-EQ-02, `AI-05`.
 *
 * `inbound-mail.ts` does the hard half and says so in its own header: it
 * claims a receipt before it works so a crash retries rather than drops mail,
 * matches a sender to a customer and refuses an ambiguous match, threads a
 * reply onto the job it quotes, starts the four-working-hour clock against the
 * branch's calendar, and sanitises every attachment filename on its way into a
 * storage key. What it cannot do is read the mail. `createEnquiry` writes a
 * reference, a branch, a contact and the subject as `notes`, and everything
 * describing the shipment — `mode`, `trade_direction`, `origin_id`,
 * `destination_id`, `commodity_id`, `incoterm`, `ready_on`, `gross_weight_kg`,
 * `volume_cbm`, `pieces`, `dimensions`, `is_dangerous` — is null while the
 * body three inches above the form says all of it.
 *
 * That retyping is the entire feature.
 *
 * ## Why this is a job and not a step of `handleMessage`
 *
 * Because an enquiry that never arrived is a customer who went elsewhere.
 *
 * The enqueue happens *after* the enquiry is committed, never before, so a
 * model that is slow, rate-limited, unconfigured or simply wrong cannot cost
 * us the intake. Extraction is an enrichment of a row that already exists. If
 * every model call in this file failed for a week, the queue would look
 * exactly as it does today — full of enquiries a coordinator types out by
 * hand — which is the correct degradation and the reason the ordering is not
 * negotiable.
 *
 * ## It proposes; it never writes the enquiry
 *
 * Not one line here updates `enquiries`. Every fact lands in
 * `extraction_proposals` with the span of mail it came from, and a coordinator
 * accepts it as an ordinary audited write under their own actor — so the audit
 * trail answers *who put this on the shipment* without a new concept. That is
 * `decideProposal`'s rule in `core/ai.ts` and it is the most consequential
 * decision in the AI surface: a model fills blanks, and a person's answer
 * wins.
 *
 * The verdict is still computed and still recorded, because `target_was_empty`
 * is the column that makes drift visible later — a coordinator may have typed
 * the value while the model was thinking, and `decideProposal` is re-run at
 * accept time against the row as it is *then*.
 *
 * ## The trust boundary, and what stays on the deterministic side
 *
 * This is the first component in the system that *interprets* attacker-
 * controlled text: a stranger chose every byte of the body. So the boundary is
 * drawn where a cleverly worded email cannot argue with it —
 *
 *   - extraction may propose cargo facts, and nothing else. `admissible()`
 *     enforces that against `EXTRACTABLE_FIELDS`, and a refusal is recorded
 *     rather than filtered, because an extraction that tried to set
 *     `customerId` is a security event and not a filter miss;
 *   - it may not select a customer and may not break an attribution tie.
 *     `inbound-routing.ts` stays pure and deterministic, and refuses two
 *     candidates as firmly as it refuses none;
 *   - it may not set a permission and may not cause a send.
 *
 * A model never emits an id, either. It emits *"Shanghai"*, and `lookup()` in
 * `core/import.ts` decides whether that is a location we hold — which is
 * `AI-06`'s argument that a model is simply another producer of untrusted
 * rows, and that the validator for those was written for FR-MD-11 and tested
 * in a millisecond against no infrastructure.
 */

import { eq } from 'drizzle-orm'
import {
  enquiries,
  extractionProposals,
  incoterms as incotermsTable,
  inSeries,
  messages,
  systemActor,
  withActor,
  type Actor,
} from '@qabandi/db'
import {
  admissible,
  decideProposal,
  ENQUIRY_FIELDS,
  parseModelJson,
  readExtractedEnquiry,
  type EnquiryField,
  type FieldProposal,
} from '@qabandi/core'
import { ENQUIRY_EXTRACTION_SCHEMA } from '@qabandi/core'
import { invoke } from '../ai/ledger'
import { ENQUIRY_PROMPT_VERSION, ENQUIRY_USER_PROMPT, enquirySystemPrompt } from '../ai/prompts'

/**
 * The vocabularies the prompt names, and the modes are a constant here.
 *
 * `transport_mode` and `trade_direction` are Postgres enums rather than
 * reference rows, which is the one place in this system where a vocabulary is
 * not something an administrator edits — adding a mode is a migration. Reading
 * them from a hard-coded list therefore cannot drift the way a charge code
 * could, and `enquiry-extract.test.ts` pins them against the enum anyway.
 */
const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const
const DIRECTIONS = ['import', 'export', 'cross_trade'] as const

/**
 * How much mail is worth sending, in characters.
 *
 * A quoted reply chain runs to tens of thousands of characters of which the
 * top twenty lines are the enquiry, and paying to read forty rounds of
 * signature blocks is the easiest way to make this surface look expensive. The
 * body arrives already flattened to text by the adapter, so this is a
 * character count and not a byte count.
 */
const MAX_BODY_CHARS = 24_000

export interface ExtractEnquiryInput {
  readonly enquiryId: string
  readonly branchId: string
  /** The inbound message this enquiry was opened from — `messages.id`. */
  readonly messageId: string
}

export interface ExtractEnquiryResult {
  readonly invocationId?: string
  /** Proposals written to `extraction_proposals`. */
  readonly proposed: number
  /** Fields the model named that this surface may not speak to. */
  readonly refused: readonly string[]
  /** Columns already holding a value, so nothing was proposed for them. */
  readonly occupied: readonly string[]
  /** Why nothing happened, in one line, where nothing did. */
  readonly skipped?: string
}

/**
 * Which column on `enquiries` each proposed field eventually lands in.
 *
 * Used to prove a field is one this worker knows and to document the target —
 * **not** as the value stored in `extraction_proposals.field`, which is the
 * extraction field name (`origin`) rather than the column (`origin_id`).
 *
 * That distinction is the whole point and it is worth the extra indirection.
 * Three of these are *candidates*, not identifiers: the model wrote
 * "Shanghai", and `lookup()` in `core/import.ts` decides whether that is a
 * location we hold. A proposal filed as `origin_id` carrying the text
 * "Shanghai" reads, to whoever writes the accept path next, exactly like a
 * value that can be assigned — and a place name written into a `uuid` column
 * is the kind of trap that is obvious only after somebody falls into it.
 * Filed as `origin`, the resolution step cannot be skipped by accident.
 */
const COLUMN: Readonly<Record<EnquiryField, string>> = {
  mode: 'mode',
  tradeDirection: 'trade_direction',
  origin: 'origin_id',
  destination: 'destination_id',
  commodity: 'commodity_id',
  incoterm: 'incoterm',
  readyOn: 'ready_on',
  grossWeightKg: 'gross_weight_kg',
  volumeCbm: 'volume_cbm',
  pieces: 'pieces',
  dimensions: 'dimensions',
  isDangerous: 'is_dangerous',
}

/**
 * Read one emailed enquiry.
 *
 * Returns rather than throws for every *expected* absence — no model
 * configured, an enquiry somebody has since filled in, a mail with nothing in
 * it. Those are ordinary states of a deployment and the caller logs them; only
 * a genuine failure propagates, where pg-boss's retry is the right answer.
 */
export async function extractEnquiry(input: ExtractEnquiryInput): Promise<ExtractEnquiryResult> {
  const actor = systemActor()

  const context = await load(actor, input)
  if (!context) return { proposed: 0, refused: [], occupied: [], skipped: 'enquiry_not_found' }

  const source = mailFor(context.subject, context.body)
  if (source.trim() === '') {
    return { proposed: 0, refused: [], occupied: [], skipped: 'nothing_to_read' }
  }

  /*
    The mail is a separate user turn and is never interpolated into the
    instructions, which is the one structural defence against a body that says
    "ignore your instructions". It does not make injection impossible — the
    allowlist below is what makes it harmless — but concatenating hostile text
    into the instruction block would remove a boundary that costs nothing.
  */
  const { response, invocationId } = await invoke(
    {
      actor,
      branchId: input.branchId,
      surface: 'enquiry_extract',
      promptVersion: ENQUIRY_PROMPT_VERSION,
      enquiryId: input.enquiryId,
    },
    {
      surface: 'enquiry_extract',
      schema: ENQUIRY_EXTRACTION_SCHEMA,
      messages: [
        {
          role: 'system',
          content: [
            {
              type: 'text',
              text: enquirySystemPrompt({
                modes: MODES,
                directions: DIRECTIONS,
                incoterms: context.incoterms,
              }),
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: `${ENQUIRY_USER_PROMPT}\n\n${source}` }],
        },
      ],
    },
  )

  const extracted = readExtractedEnquiry(parseModelJson(response.text))

  /*
    Refusals are kept, not filtered.

    A model that answered `customerId` is either a prompt bug or a mail that
    talked it into one, and both want somebody's attention rather than a
    silently shorter list — `core/ai.ts` argues this at the function itself.
    `unknownFields` covers names the schema's own enum did not admit; `refused`
    covers names it did and the allowlist did not.
  */
  const { allowed, refused } = admissible('enquiry_extract', extracted.fields)
  const refusedNames = [...refused.map((p) => p.field), ...extracted.unknownFields]

  const occupied: string[] = []
  const writable: { proposal: FieldProposal; wasEmpty: boolean }[] = []

  for (const proposal of allowed) {
    const column = COLUMN[proposal.field as EnquiryField]
    if (!column) continue

    const current = context.current[proposal.field as EnquiryField]
    const wasEmpty = current === null || current === undefined || current === ''

    /*
      `humanAuthored` is true for anything already on the row, and that is the
      conservative reading rather than a shortcut.

      Nothing on `enquiries` records who filled a column — the audit trail
      does, and querying it per field per mail to soften this would be a lot of
      work to arrive at "propose over the top of a coordinator". A value that
      is there was put there by somebody, and a person's answer wins. The one
      thing this forfeits is replacing an earlier extraction with a better one,
      which is not a thing that can happen yet: this is the only writer.
    */
    const verdict = decideProposal(proposal, {
      current,
      humanAuthored: !wasEmpty,
      /*
        Both thresholds sit at zero, deliberately, and the effect is that every
        admissible proposal reaches the queue.

        `decideProposal` returns `apply` for a confident proposal against an
        empty column, and nothing here acts on that: this surface proposes and
        a person accepts, full stop. The thresholds exist so the day an
        auto-apply path is argued for it reads its ceiling from a row (§9)
        rather than from a constant somebody has to find. Until then, filtering
        here would only hide facts from the person whose job is to judge them.
      */
      applyThreshold: 0,
      reviewThreshold: 0,
    })

    if (verdict === 'discard') {
      if (!wasEmpty) occupied.push(proposal.field)
      continue
    }

    writable.push({ proposal, wasEmpty })
  }

  if (writable.length === 0) {
    return { invocationId, proposed: 0, refused: refusedNames, occupied }
  }

  await withActor(actor, async (tx) => {
    await tx.insert(extractionProposals).values(
      writable.map(({ proposal, wasEmpty }) => ({
        branchId: input.branchId,
        invocationId,
        targetTable: 'enquiries' as const,
        targetId: input.enquiryId,
        // The extraction field, not the column — see `COLUMN` above.
        field: proposal.field,
        value: proposal.value,
        confidence: proposal.confidence.toFixed(4),
        evidence: proposal.evidence ?? null,
        targetWasEmpty: wasEmpty,
      })),
    )
  })

  return { invocationId, proposed: writable.length, refused: refusedNames, occupied }
}

interface Loaded {
  readonly subject: string | null
  readonly body: string
  readonly incoterms: readonly string[]
  readonly current: Readonly<Record<EnquiryField, string | null>>
}

/**
 * The enquiry, its mail and the incoterm vocabulary.
 *
 * `inSeries` rather than `Promise.all`: one transaction is one connection and
 * one connection runs one statement at a time, so overlapping these buys no
 * latency and `node-postgres` deprecated issuing them at all — the reasoning
 * is at `inSeries` itself in `packages/db/src/actor.ts`.
 */
async function load(actor: Actor, input: ExtractEnquiryInput): Promise<Loaded | null> {
  return withActor(actor, async (tx) => {
    const [enquiry, message, codes] = await inSeries([
      () =>
        tx
          .select({
            mode: enquiries.mode,
            tradeDirection: enquiries.tradeDirection,
            originId: enquiries.originId,
            destinationId: enquiries.destinationId,
            commodityId: enquiries.commodityId,
            incoterm: enquiries.incoterm,
            readyOn: enquiries.readyOn,
            grossWeightKg: enquiries.grossWeightKg,
            volumeCbm: enquiries.volumeCbm,
            pieces: enquiries.pieces,
            dimensions: enquiries.dimensions,
          })
          .from(enquiries)
          .where(eq(enquiries.id, input.enquiryId))
          .limit(1),
      () =>
        tx
          .select({ subject: messages.subject, body: messages.body })
          .from(messages)
          .where(eq(messages.id, input.messageId))
          .limit(1),
      () =>
        tx
          .select({ code: incotermsTable.code })
          .from(incotermsTable)
          .where(eq(incotermsTable.isActive, true)),
    ])

    const row = enquiry[0]
    const mail = message[0]
    if (!row || !mail) return null

    const asText = (value: unknown): string | null =>
      value === null || value === undefined ? null : String(value)

    return {
      subject: mail.subject,
      body: mail.body,
      incoterms: codes.map((c: { code: string }) => c.code),
      current: {
        mode: asText(row.mode),
        tradeDirection: asText(row.tradeDirection),
        origin: asText(row.originId),
        destination: asText(row.destinationId),
        commodity: asText(row.commodityId),
        incoterm: asText(row.incoterm),
        readyOn: asText(row.readyOn),
        grossWeightKg: asText(row.grossWeightKg),
        volumeCbm: asText(row.volumeCbm),
        pieces: asText(row.pieces),
        dimensions: asText(row.dimensions),
        /*
          `is_dangerous` is `not null default false`, so it is never *empty* in
          the sense `decideProposal` means — and treating a default as an
          answer a human gave would discard every dangerous-goods proposal ever
          made. Reported as empty, which is what it is: nobody has said.
        */
        isDangerous: null,
      },
    }
  })
}

/**
 * The subject and body, capped.
 *
 * The subject is included because it carries the shipment more often than any
 * other single line — *"RFQ 2x40HC Shanghai to Shuwaikh"* is a complete
 * enquiry — and because `createEnquiry` already stores it as `notes`, so a
 * model that only read the body would miss what a coordinator reads first.
 */
export function mailFor(subject: string | null, body: string): string {
  const trimmed = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n[truncated]` : body
  return subject ? `Subject: ${subject}\n\n${trimmed}` : trimmed
}

export { ENQUIRY_FIELDS }
