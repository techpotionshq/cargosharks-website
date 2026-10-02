/**
 * The operator assistant — what it may ask, and what it may propose.
 *
 * `docs/Qabandi_AI_Surface.md` argues that what makes a product assistant feel
 * like software rather than a chatbot is that it has no private idea of what
 * is true: it reads through the same queries the interface reads through,
 * writes through the same mutations, and can be handed work like a colleague.
 * This file is the first two of those, as data.
 *
 * ## It never writes. It proposes, and a person commits.
 *
 * `isWriteSurface('assistant')` is false and `EXTRACTABLE_FIELDS.assistant` is
 * empty, and both are enforced rather than documented. The assistant's
 * "actions" are therefore not actions: `propose_transition` returns a
 * *suggestion* that the interface renders as a button, and pressing it runs
 * the ordinary server action under the person's own actor — the same code
 * path, the same permission check, the same audit row as clicking it on the
 * screen would have produced.
 *
 * That is not a safety blanket bolted on afterwards. It is the only design
 * that leaves the audit trail able to answer *who moved this job*, because the
 * answer stays the name of a person.
 *
 * ## The transition table is already the manifest
 *
 * `states.ts` declares every legal transition as `{ from, to, requires, label }`
 * across enquiries, quotes, jobs, customs and invoices. Nothing here restates
 * that. `proposableTransitions` reads the machines directly, so a transition
 * added to the product is a transition the assistant can suggest on the same
 * commit, and one removed stops being suggestible without anybody remembering
 * to look here.
 *
 * ## Reading is scoped by the database, not by this file
 *
 * The read tools below name queries, and every one of them runs inside
 * `withActor` — so RLS decides what comes back. A Doha coordinator asking
 * which jobs are stuck in clearance gets Doha's jobs because the policy says
 * so, not because a prompt was careful. There is deliberately no `branchId`
 * parameter on any read tool: a tool that takes one is a tool a model can be
 * talked into pointing somewhere else.
 */

import {
  customsMachine,
  enquiryMachine,
  invoiceMachine,
  jobMachine,
  quoteMachine,
  transitionsFrom,
  type Machine,
  type Transition,
} from './states'
import { AiError } from './ai'
import { MODES } from './extraction'
import type { LabelVocabulary } from './labels'

/* -------------------------------------------------------------------------
 * Tools
 * ---------------------------------------------------------------------- */

/**
 * What a tool does when the model calls it.
 *
 * `read` runs immediately and its result goes back to the model. `propose`
 * runs nothing at all — it is collected, returned to the interface, and waits
 * for a person. Keeping the two as a *kind* on the declaration rather than as
 * a naming convention is what lets the loop enforce the difference in one
 * place instead of at every call site.
 */
export type ToolKind = 'read' | 'propose'

export interface AssistantTool {
  readonly name: string
  readonly kind: ToolKind
  /**
   * What the model is told this does.
   *
   * Written for the model, and therefore written about the *business* rather
   * than the schema: "shipments that have arrived but not cleared customs"
   * gets called correctly, "rows where status = 'arrived'" gets called when
   * somebody asks about rows.
   */
  readonly description: string
  readonly parameters: Record<string, unknown>
  /**
   * The permission a caller must hold for this tool to be offered at all.
   *
   * Absent means every internal principal may use it — which is true of the
   * read tools, because RLS has already decided what they can see and a
   * second gate would only disagree with it. Present on the proposal tools,
   * where the question is not what you can see but what you may change.
   */
  readonly requires?: string
  /**
   * Which coded values in this tool's result get a label beside them, by path
   * (`rows.status`) — see `withLabels` in `labels.ts`. Declared with the tool
   * so a column added to a result is labelled where its shape is described.
   */
  readonly labels?: Readonly<Record<string, LabelVocabulary>>
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  // Every property required, nullable where optional — the rule
  // `extraction.ts` learned from a live call: a key outside `required` is one
  // the model may decline to emit, and a silently absent filter is a query
  // that answered a different question than the one asked.
  required: Object.keys(properties),
  properties: Object.fromEntries(
    Object.entries(properties).map(([key, schema]) => [
      key,
      required.includes(key) ? schema : nullable(schema as Record<string, unknown>),
    ]),
  ),
})

function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  const type = schema.type
  return {
    ...schema,
    type: Array.isArray(type) ? type : [type, 'null'],
    // JSON Schema checks `enum` separately from `type`: a nullable enum whose
    // list lacks null still refuses null, and a strict provider says so.
    ...(Array.isArray(schema.enum) ? { enum: [...(schema.enum as unknown[]), null] } : {}),
  }
}

/**
 * A closed set of values, declared as one.
 *
 * Prose like "sea, air or land" in a description is how `list_jobs` came to be
 * asked for `mode: "sea"` against a column holding `sea_fcl` and `sea_lcl`, and
 * to answer "no sea shipments" on a board full of them (ai-1). An `enum` tells
 * the model the real vocabulary, and `normaliseToolArgs` holds the line where a
 * model writes something outside it anyway.
 */
const oneOf = (values: readonly string[], description?: string): Record<string, unknown> => ({
  type: 'string',
  enum: [...values],
  ...(description ? { description } : {}),
})

/*
  The vocabularies, read from the machines wherever one exists so a status
  added to `states.ts` is a status the assistant can filter on.
*/
const JOB_STATUSES = jobMachine.states
const ENQUIRY_STATUSES = enquiryMachine.states
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const TRADE_DIRECTIONS = ['import', 'export', 'cross_trade'] as const
const PROPOSABLE = ['job', 'enquiry', 'quote', 'invoice', 'customs'] as const

/**
 * The modes a person asks about, which are not quite the modes we store.
 *
 * Nobody says "sea_fcl or sea_lcl"; they say "sea". So the filter offers the
 * family as well as each stored mode, and `modesFor` expands it. Courier stays
 * its own value: it is a different product with a different price, not a kind
 * of air freight a coordinator would expect folded in.
 */
export const MODE_FILTERS = ['sea', ...MODES] as const
export type ModeFilter = (typeof MODE_FILTERS)[number]

export function modesFor(filter: ModeFilter): (typeof MODES)[number][] {
  return filter === 'sea' ? ['sea_fcl', 'sea_lcl'] : [filter]
}

/**
 * Words a model writes when it means `null`.
 *
 * Found in a live call: asked which invoices were overdue, a model chose the
 * right tool and filled the optional customer filter with `"None"` — a search
 * for a customer called None, which answered "nothing is overdue" on a day when
 * several invoices were. `tools.ts` reads free-text filters through this set;
 * `normaliseToolArgs` reads the closed ones through it too.
 */
export const NULLISH_WORDS: ReadonlySet<string> = new Set([
  'none',
  'null',
  'nil',
  'undefined',
  'n/a',
  'na',
  'any',
  'all',
  '-',
])

/**
 * What a model writes for a value it knows by another name.
 *
 * Per parameter, and applied only when the result is in that parameter's own
 * enum — `"clearance"` means `customs` to a shipment and nothing to an enquiry,
 * and the enum is what decides which.
 */
const ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  mode: {
    ocean: 'sea',
    ocean_freight: 'sea',
    sea_freight: 'sea',
    fcl: 'sea_fcl',
    lcl: 'sea_lcl',
    air_freight: 'air',
    road: 'land',
    truck: 'land',
    trucking: 'land',
    overland: 'land',
    express: 'courier',
  },
  status: {
    clearance: 'customs',
    in_clearance: 'customs',
    customs_clearance: 'customs',
    transit: 'in_transit',
    hold: 'on_hold',
  },
}

export type NormalisedArgs =
  | { readonly ok: true; readonly args: Record<string, unknown> }
  | { readonly ok: false; readonly error: string }

/**
 * Hold a model's arguments to the tool's declared vocabulary.
 *
 * Every parameter with an `enum`, on every tool — driven by the schema, so a
 * tool added with a closed parameter is checked without anybody remembering to
 * add it here. Case, spacing and hyphens are forgiven, a written-out null
 * becomes null, a known alias becomes the stored value.
 *
 * Anything else is *refused*, with the values that would work, rather than
 * passed through. Passed through, `status: "pending"` is a filter that matches
 * nothing and an answer of "there are none", stated with confidence; refused,
 * it is a turn in which the model picks a real status and asks again.
 */
export function normaliseToolArgs(
  tool: AssistantTool,
  args: Record<string, unknown>,
): NormalisedArgs {
  const properties = (tool.parameters.properties ?? {}) as Record<string, Record<string, unknown>>
  const out: Record<string, unknown> = { ...args }

  for (const [key, schema] of Object.entries(properties)) {
    if (!Array.isArray(schema.enum)) continue
    const allowed = (schema.enum as unknown[]).filter((v): v is string => typeof v === 'string')
    const raw = args[key]

    if (raw === null || raw === undefined) {
      out[key] = null
      continue
    }
    if (typeof raw !== 'string') {
      return { ok: false, error: `${key} must be one of: ${allowed.join(', ')}.` }
    }

    const word = raw
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    if (word === '' || NULLISH_WORDS.has(word)) {
      out[key] = null
      continue
    }

    const value = allowed.includes(word) ? word : ALIASES[key]?.[word]
    if (!value || !allowed.includes(value)) {
      return {
        ok: false,
        error: `"${raw}" is not a ${key} ${tool.name} understands. Use one of: ${allowed.join(', ')} — or null for no filter.`,
      }
    }
    out[key] = value
  }

  return { ok: true, args: out }
}

const REFERENCE = {
  type: 'string',
  description: 'Our reference, e.g. KWI-JOB-2026-00042 or KWI-ENQ-2026-00017.',
}

/**
 * Every tool the assistant can be offered.
 *
 * Deliberately a short list. A model given forty tools picks the wrong one;
 * given eight that map onto how a forwarder actually talks about their week,
 * it picks the right one and the failure mode is "I could not find that"
 * rather than a confident answer from the wrong table.
 */
export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  {
    name: 'search',
    kind: 'read',
    labels: {
      'shipments.status': 'jobStatus',
      'shipments.mode': 'mode',
      'enquiries.status': 'enquiryStatus',
      'invoices.status': 'invoiceStatus',
    },
    description:
      'Find a shipment, enquiry, quote, invoice or customer by reference, name or container number. Use this first whenever the person names something specific.',
    parameters: objectSchema(
      {
        query: { type: 'string', description: 'A reference, company name or container number.' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      ['query'],
    ),
  },
  {
    name: 'get_job',
    kind: 'read',
    labels: {
      'shipment.status': 'jobStatus',
      'shipment.mode': 'mode',
      'shipment.tradeDirection': 'direction',
      'openExceptions.severity': 'severity',
      'customs.status': 'customsStatus',
    },
    description:
      'Everything about one shipment: parties, cargo, milestones, customs state, charge lines and open exceptions.',
    parameters: objectSchema({ reference: REFERENCE }, ['reference']),
  },
  {
    name: 'list_jobs',
    kind: 'read',
    labels: { 'rows.status': 'jobStatus', 'rows.mode': 'mode', 'rows.direction': 'direction' },
    description:
      'Shipments the person can see, newest first, optionally narrowed by status, mode, direction or arrival window. Returns `total` (every match) and the first `shown` rows. Use for questions like "what is in clearance", "how many sea imports do we have" or "what is arriving this week" (arrivingWithinDays: 7).',
    parameters: objectSchema({
      status: oneOf(JOB_STATUSES, '"customs" means in customs clearance.'),
      mode: oneOf(
        MODE_FILTERS,
        '"sea" covers both full-container (sea_fcl) and groupage (sea_lcl).',
      ),
      direction: oneOf(TRADE_DIRECTIONS),
      arrivingWithinDays: {
        type: 'integer',
        minimum: 0,
        maximum: 60,
        description:
          'Only shipments not yet arrived whose ETA falls between now and this many days ahead, soonest first.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_enquiries',
    kind: 'read',
    labels: { 'rows.status': 'enquiryStatus' },
    description:
      'Open enquiries on the board, including how long is left on the four-working-hour first-response clock. Returns `total` (every match) and the first `shown` rows. Use for "what needs answering", "how many enquiries are open" and anything about the SLA.',
    parameters: objectSchema({
      /*
        Live, asked "how many enquiries are open", a model filtered on `new`
        and answered 4 when 9 were open — "open" read as a status. Said here,
        where the model chooses the filter.
      */
      status: oneOf(
        ENQUIRY_STATUSES,
        'Leave null to count every open enquiry. "new" means received and not yet assigned — only a part of what is open.',
      ),
      overdueOnly: { type: 'boolean', description: 'Only those past their SLA.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_exceptions',
    kind: 'read',
    labels: { 'rows.severity': 'severity' },
    description:
      'Open exceptions across shipments, most severe and longest open first. Returns `total` and the first `shown` rows. Use for "what is going wrong" and "what should I look at today".',
    parameters: objectSchema({
      severity: oneOf(SEVERITIES),
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_free_time',
    kind: 'read',
    labels: { 'rows.kind': 'clockKind' },
    description:
      'Containers whose free time is running out or has expired, and what the demurrage exposure is. Returns `total` and the first `shown` rows. Use for anything about free time, detention, demurrage or storage.',
    parameters: objectSchema({
      withinDays: { type: 'integer', minimum: 0, maximum: 60 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_overdue_invoices',
    kind: 'read',
    description:
      'Customer invoices past their due date with the balance outstanding and how many days late, plus `total` and the outstanding sum per currency. Use for anything about receivables, ageing or chasing payment.',
    parameters: objectSchema({
      customer: { type: 'string', description: 'Narrow to one customer by name or code.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'get_invoice',
    kind: 'read',
    labels: { 'invoice.status': 'invoiceStatus' },
    description:
      'One customer invoice by its number: customer, status, total, paid, credited, the balance still owed, due date and days overdue. Use whenever the person asks about a specific invoice, its balance or whether it is paid.',
    parameters: objectSchema(
      {
        number: {
          type: 'string',
          description: 'The invoice number, e.g. KWI-INV-2026-00012 (or a distinctive part of it).',
        },
      },
      ['number'],
    ),
  },
  {
    name: 'list_unbilled',
    kind: 'read',
    labels: { 'rows.status': 'jobStatus' },
    description:
      'Shipments carrying revenue that was earned but never invoiced, largest first, with the amount in the branch base currency, plus `total`. Use for "what have we not billed", "unbilled revenue" and anything about revenue leaking.',
    parameters: objectSchema({
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_quotes_expiring',
    kind: 'read',
    labels: { 'rows.status': 'quoteStatus' },
    description:
      'Sent quotations approaching the end of their validity, soonest first, with the customer and the quoted total, plus `total` (how many). Use for "which quotes are about to lapse" and following up before a price expires.',
    parameters: objectSchema({
      withinDays: { type: 'integer', minimum: 0, maximum: 60 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'get_customer_credit',
    kind: 'read',
    /*
      Per branch, not one figure. Credit limits are agreed per legal entity, so
      a customer can be well inside their limit in Kuwait and on hold in Dubai —
      and the tool takes no branch (none of them do; RLS decides what is
      visible), so it answers for every branch the asker can see rather than
      guessing which one they meant.
    */
    description:
      'A customer’s credit standing at each branch you can see: what they owe, their limit, the headroom left, and whether they are over the limit or on hold. Use for "can this customer book more", "are they on hold" and any credit question.',
    parameters: objectSchema(
      { customer: { type: 'string', description: 'The customer, by name or code.' } },
      ['customer'],
    ),
  },
  {
    name: 'list_consolidation_candidates',
    kind: 'read',
    labels: { mode: 'mode' },
    description:
      'Loose LCL and air shipments on the same lane that could have shared a container, grouped, largest first, with the container each group would fill. Use for "what could we consolidate", "any co-load opportunities" and finding freight bought retail that should have been bought wholesale.',
    parameters: objectSchema({
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'get_supplier_variance',
    kind: 'read',
    description:
      'Where a supplier has billed something other than what the job accrued, with the variance per line. Use for "did the agent overcharge us" and anything about a disputed bill.',
    parameters: objectSchema({ reference: REFERENCE }, ['reference']),
  },
  {
    name: 'get_margin',
    kind: 'read',
    description:
      'The profit and loss on one shipment — revenue, cost, gross margin and how much of the cost is still an accrual rather than a billed figure, in the branch base currency. Use for "what did we make on", "is this job profitable" and any margin question.',
    parameters: objectSchema({ reference: REFERENCE }, ['reference']),
  },
  {
    name: 'propose_transition',
    kind: 'propose',
    /*
      The description says "propose", twice, and says who decides.

      A model told it can "move a job to arrived" reports afterwards that it
      did — and the person reads a sentence claiming a state change that is
      sitting unconfirmed in front of them. Being explicit here is cheaper than
      correcting the transcript afterwards.
    */
    description:
      'Propose moving a shipment, enquiry, quote, invoice or customs file to a new state. This does NOT perform the change: it offers the person a button to confirm. Say that you have suggested it, never that you have done it.',
    parameters: objectSchema(
      {
        entity: oneOf(PROPOSABLE),
        reference: REFERENCE,
        to: { type: 'string', description: 'The state to move to.' },
        reason: { type: 'string', description: 'One line the person will see beside the button.' },
      },
      ['entity', 'reference', 'to'],
    ),
    /*
      One permission for the tool, and the *specific* transition's own
      permission checked again when the proposal is built. They are different
      questions: whether this person is the sort who moves records at all, and
      whether they may make this particular move.
    */
    requires: 'job.update',
  },
]

/** The tools this principal may be offered, given what they hold. */
export function toolsFor(permissions: ReadonlySet<string>): AssistantTool[] {
  return ASSISTANT_TOOLS.filter((tool) => !tool.requires || permissions.has(tool.requires))
}

export function assistantTool(name: string): AssistantTool | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.name === name)
}

/* -------------------------------------------------------------------------
 * Proposals
 * ---------------------------------------------------------------------- */

export type ProposableEntity = 'job' | 'enquiry' | 'quote' | 'invoice' | 'customs'

const MACHINES: Readonly<Record<ProposableEntity, Machine<string>>> = {
  job: jobMachine as Machine<string>,
  enquiry: enquiryMachine as Machine<string>,
  quote: quoteMachine as Machine<string>,
  invoice: invoiceMachine as Machine<string>,
  customs: customsMachine as Machine<string>,
}

export function isProposableEntity(value: string): value is ProposableEntity {
  return value in MACHINES
}

/**
 * What this record could legally become, filtered to what this person may do.
 *
 * Given to the model *with the record*, rather than left for it to guess from
 * the state name. A model that has been shown `arrived -> customs (Entered
 * clearance)` and `arrived -> delivered (Delivered)` proposes one of the two;
 * a model shown only `arrived` invents `cleared`, which is refused, which
 * produces a turn of apology and a second wrong guess.
 */
export function proposableTransitions(
  entity: ProposableEntity,
  from: string,
  permissions: ReadonlySet<string>,
): Transition<string>[] {
  return transitionsFrom(MACHINES[entity], from).filter(
    (transition) => !transition.requires || permissions.has(transition.requires),
  )
}

export interface TransitionProposal {
  readonly entity: ProposableEntity
  readonly reference: string
  /**
   * The record's own id, so the interface can link straight at it.
   *
   * Carried rather than looked up again on the web side, and rather than
   * having the button navigate by reference: the register screens filter by
   * status, not by reference, so a link built from one lands the coordinator
   * on an unfiltered list with no indication of which row was meant. The id is
   * already in hand — the loop reads the record's current state before it will
   * offer any transition at all — so not carrying it was simply losing it.
   *
   * For a customs proposal this is the *job's* id: customs stages hang off a
   * shipment and have no screen of their own.
   */
  readonly targetId: string
  readonly from: string
  readonly to: string
  /** The transition's own label, from `states.ts` — not the model's words. */
  readonly label: string
  /** The permission the confirming action will check again. */
  readonly requires?: string
  /** The model's one line, shown beside the button. */
  readonly reason?: string
}

/**
 * Turn a model's suggestion into a proposal, or refuse it.
 *
 * Three refusals, and each is a thing a model does:
 *
 *   - an entity we do not have a machine for;
 *   - a transition the machine does not allow from where the record is;
 *   - a transition this person may not make.
 *
 * The third is not redundant with the confirm action's own check. It decides
 * whether the button is *offered*, and offering a button that will refuse is
 * how an assistant teaches people to distrust it.
 *
 * The label comes from `states.ts` and never from the model. "Entered
 * clearance" is the product's own word for that transition, it is already
 * translated, and letting a model phrase it would put a fourth vocabulary in
 * front of a coordinator who has learned three.
 */
export function proposeTransition(input: {
  readonly entity: string
  readonly reference: string
  readonly targetId: string
  readonly from: string
  readonly to: string
  readonly reason?: string
  readonly permissions: ReadonlySet<string>
}): TransitionProposal {
  const { entity, reference, targetId, from, to, reason, permissions } = input

  if (!isProposableEntity(entity)) {
    throw new AiError('assistant.unknown_entity', `There is no ${entity} to move.`)
  }

  const allowed = transitionsFrom(MACHINES[entity], from)
  const transition = allowed.find((candidate) => candidate.to === to)

  if (!transition) {
    const options = allowed.map((candidate) => candidate.to)
    throw new AiError(
      'assistant.illegal_transition',
      options.length > 0
        ? `A ${entity} in ${from} cannot move to ${to}. It can move to: ${options.join(', ')}.`
        : `A ${entity} in ${from} is final; it cannot move.`,
    )
  }

  if (transition.requires && !permissions.has(transition.requires)) {
    throw new AiError(
      'assistant.not_permitted',
      `You do not have permission to move a ${entity} to ${to}.`,
    )
  }

  return {
    entity,
    reference,
    targetId,
    from,
    to,
    label: transition.label,
    requires: transition.requires,
    reason,
  }
}

/* -------------------------------------------------------------------------
 * Bounds
 * ---------------------------------------------------------------------- */

/**
 * How far the loop may go before it must answer.
 *
 * A tool-calling loop with no ceiling is a spend incident waiting for a model
 * that decides to look one more time. Six turns is comfortably more than any
 * question a coordinator actually asks — "which of these is worst" is a search
 * and a fetch — and it is a bound rather than a target: most answers take two.
 *
 * `maxToolCalls` is separate because one turn may ask for several tools at
 * once, and a model that requests twenty parallel reads has misunderstood the
 * question rather than found a hard one.
 */
export const ASSISTANT_LIMITS = {
  maxTurns: 6,
  maxToolCalls: 20,
  /** Rows returned to the model from any one tool. */
  maxRows: 50,
} as const
