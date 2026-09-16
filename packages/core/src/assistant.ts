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
  return { ...schema, type: Array.isArray(type) ? type : [type, 'null'] }
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
    description:
      'Everything about one shipment: parties, cargo, milestones, customs state, charge lines and open exceptions.',
    parameters: objectSchema({ reference: REFERENCE }, ['reference']),
  },
  {
    name: 'list_jobs',
    kind: 'read',
    description:
      'Shipments the person can see, newest first, optionally narrowed by status or mode. Use for questions like "what is in clearance" or "what is arriving this week".',
    parameters: objectSchema({
      status: {
        type: 'string',
        description:
          'draft, booked, in_transit, arrived, customs, delivered, completed, closed, on_hold or cancelled.',
      },
      mode: { type: 'string', description: 'sea, air or land.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_enquiries',
    kind: 'read',
    description:
      'Enquiries on the board, including how long is left on the four-working-hour first-response clock. Use for "what needs answering" and anything about the SLA.',
    parameters: objectSchema({
      status: {
        type: 'string',
        description: 'new, assigned, rating, quoted, won, lost, cancelled.',
      },
      overdueOnly: { type: 'boolean', description: 'Only those past their SLA.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_exceptions',
    kind: 'read',
    description:
      'Open exceptions across shipments, most severe and longest open first. Use for "what is going wrong" and "what should I look at today".',
    parameters: objectSchema({
      severity: { type: 'string', description: 'low, medium, high or critical.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_free_time',
    kind: 'read',
    description:
      'Containers whose free time is running out or has expired, and what the demurrage exposure is. Use for anything about detention, demurrage or storage.',
    parameters: objectSchema({
      withinDays: { type: 'integer', minimum: 0, maximum: 60 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_overdue_invoices',
    kind: 'read',
    description:
      'Customer invoices past their due date with the amount outstanding and how many days late. Use for anything about receivables, ageing or chasing payment.',
    parameters: objectSchema({
      customer: { type: 'string', description: 'Narrow to one customer by name or code.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_unbilled',
    kind: 'read',
    description:
      'Shipments carrying revenue that was earned but never invoiced, largest first, with the amount in the branch base currency. Use for "what have we not billed", "unbilled revenue" and anything about revenue leaking.',
    parameters: objectSchema({
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  },
  {
    name: 'list_quotes_expiring',
    kind: 'read',
    description:
      'Sent quotations approaching the end of their validity, soonest first, with the customer and the quoted total. Use for "which quotes are about to lapse" and following up before a price expires.',
    parameters: objectSchema({
      withinDays: { type: 'integer', minimum: 0, maximum: 60 },
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
        entity: {
          type: 'string',
          description: 'job, enquiry, quote, invoice or customs.',
        },
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
