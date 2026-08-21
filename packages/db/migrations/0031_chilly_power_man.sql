-- The AI ledger and the proposal queue: tenancy, audit, and three guards the
-- application must not be the only thing enforcing.
--
-- Both tables are Shape 1 from `0004_rls.sql` — internal-only and
-- branch-scoped, with `branch_id` not null, so there is no "unscoped
-- configuration row" arm to write. A model call belongs to exactly one legal
-- entity because the document it read does.
--
-- No customer or agent arm on either, deliberately and for different reasons.
-- `ai_invocations` stores the prompt and the raw response: a customer contact
-- reaching it would read the desk's reasoning about their own file, and an
-- agent contact would read another agent's rates. `extraction_proposals` is a
-- work queue for the operator's staff; a proposal is not a fact about the
-- shipment until somebody accepts it, and showing an unaccepted guess through
-- the portal is how a model's mistake becomes a commitment.

alter table ai_invocations enable row level security;
alter table ai_invocations force  row level security;

create policy ai_invocations_scope on ai_invocations using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then branch_id = any(app.branch_ids())
    else false
  end);

alter table extraction_proposals enable row level security;
alter table extraction_proposals force  row level security;

create policy extraction_proposals_scope on extraction_proposals using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then branch_id = any(app.branch_ids())
    else false
  end);

-- --------------------------------------------------------------------------
-- A proposal may only target a table it is allowed to target
-- --------------------------------------------------------------------------
--
-- `target_table` is the column that decides which table an accept will write
-- to, and its value arrives adjacent to model output. Everything upstream
-- checks it — `PROPOSAL_TARGETS` in the schema, the allowlist in
-- `core/ai.ts` — and none of that is visible to a migration, a seed, or a fix
-- applied against psql at 2am.
--
-- The constraint is here because the failure it prevents is silent. A
-- proposal pointing at `principals` or `role_permissions` would look exactly
-- like any other row in the queue, and the accept path would be asked to
-- write a column nobody intended to expose. Refusing it at the boundary makes
-- that unrepresentable rather than merely unreachable.
--
-- Kept in step with `PROPOSAL_TARGETS` by hand, which is the honest cost: two
-- places, and the SQL is the one that cannot be talked out of it.
alter table extraction_proposals add constraint extraction_proposals_target_allowed
  check (target_table in (
    'enquiries',
    'documents',
    'job_cargo',
    'supplier_invoice_lines',
    'rate_card_lines'
  ));

-- --------------------------------------------------------------------------
-- Confidence is a fraction, and cost is not negative
-- --------------------------------------------------------------------------
--
-- Both are arithmetic the application already does — `confidence()` clamps to
-- `[0,1]` in `core/ai.ts` — and both are worth stating again here for the
-- same reason the mailbox ciphertext check exists: the paths that bypass the
-- application are the paths nobody reviews. A confidence of 12 would sort to
-- the top of every review queue forever, and a negative cost would make a
-- month's spend read lower than it was.
alter table extraction_proposals add constraint extraction_proposals_confidence_range
  check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table ai_invocations add constraint ai_invocations_cost_not_negative
  check (cost_usd is null or cost_usd >= 0);

-- --------------------------------------------------------------------------
-- A decided proposal names who decided it
-- --------------------------------------------------------------------------
--
-- The whole argument for the proposal table is that a model fills blanks and a
-- person's answer wins. That claim is only worth making if the person is
-- recorded — otherwise "accepted" is a state the system can reach on its own,
-- and the audit trail cannot answer who put a value on a shipment.
--
-- `refused` is exempt, and it is the one state that must be: it is the
-- allowlist in `core/ai.ts` catching a model reaching for a field its surface
-- may not speak to. Nobody decided it, and demanding a decider would either
-- block the record or invent one — and that record is the only evidence a
-- prompt-injection attempt happened at all.
alter table extraction_proposals add constraint extraction_proposals_decision_attributed
  check (
    status in ('proposed', 'refused')
    or (decided_by_id is not null and decided_at is not null)
  );

-- --------------------------------------------------------------------------
-- Audit
-- --------------------------------------------------------------------------
--
-- Attached like every other business table (§5). Worth being explicit about
-- what that means for `ai_invocations`, because it is unusual: the trail will
-- carry the request and response JSON, so `audit_log` accumulates copies of
-- prompts and model output.
--
-- That is the right trade rather than an oversight, and the same one `0027`
-- makes for sealed mailbox passwords. These rows are insert-only in practice —
-- an invocation is written once and never updated — so the audit volume is a
-- second copy at insert and nothing thereafter. And the question it exists to
-- answer is the one that matters after an incident: whether anything edited
-- the record of what the model was asked.
select app.attach_audit('ai_invocations');
select app.attach_audit('extraction_proposals');
