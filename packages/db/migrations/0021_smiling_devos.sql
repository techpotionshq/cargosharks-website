-- Proof of delivery, credit enforcement and the free-time warning — the half
-- Drizzle does not model.
--
-- 0020 created the three tables and the column. This is what makes them safe:
-- the foreign keys the schema modules could not declare without a cycle, the
-- checks that stop a POD or an override recording something it cannot mean,
-- and the row-level security without which all three are readable by every
-- branch at once.
--
-- ## Why proof of delivery is customer-visible by default and an override is not
--
-- They are the same shape — job-derived, branch-scoped — and opposite in who
-- they are for. A POD is the document the customer chases us for; withholding
-- it by default would mean every delivery needs an extra click before it is
-- useful. A credit override is a manager's judgement about a customer's
-- solvency, and there is no reading of "transparency" under which the customer
-- gets to see the sentence explaining why we let them trade past their limit.

-- --------------------------------------------------------------------------
-- The foreign keys the schema modules could not declare
-- --------------------------------------------------------------------------

/*
  Self-reference, exactly as `documents.superseded_by_id` in 0002.

  A corrected POD points at the one it corrects. Declaring this in TypeScript
  would need the table to reference itself before it is defined.
*/
alter table proof_of_delivery
  add constraint proof_of_delivery_superseded_by_fk
  foreign key (superseded_by_id) references proof_of_delivery (id);

/*
  `credit_overrides` lives in `commercial.ts` and points at `jobs` and
  `invoices`, which live in `jobs.ts` and `finance.ts` — and both of those
  already import `commercial.ts` for customers and partners. Declaring these
  two in TypeScript would close the cycle, so they are declared here, the same
  way 0018 handled `supplier_invoices.settlement_id`.
*/
alter table credit_overrides
  add constraint credit_overrides_job_fk foreign key (job_id) references jobs (id),
  add constraint credit_overrides_invoice_fk foreign key (invoice_id) references invoices (id);

-- --------------------------------------------------------------------------
-- What the rows are allowed to say
-- --------------------------------------------------------------------------

alter table proof_of_delivery
  /*
    An exception with no note is the delivery nobody can act on.

    "Delivered short" tells a claims handler that something is wrong and
    nothing about what. Same reasoning as 0018's variance acceptance: the
    reason is the entire value of the record six months later.
  */
  add constraint proof_of_delivery_exception_has_notes check (
    (has_exception = false) or (exception_notes is not null and exception_notes <> '')
  ),
  add constraint proof_of_delivery_receiver_named check (received_by_name <> ''),
  /*
    Coordinates arrive as a pair or not at all.

    A latitude with no longitude is not a partial fix, it is a bug upstream —
    and it would plot on the prime meridian, which is a confident wrong answer
    where null is an honest one.
  */
  add constraint proof_of_delivery_coordinates_paired check (
    (latitude is null) = (longitude is null)
  ),
  add constraint proof_of_delivery_coordinates_on_earth check (
    latitude is null
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  add constraint proof_of_delivery_accuracy_positive check (
    accuracy_metres is null or accuracy_metres >= 0
  );

alter table credit_overrides
  add constraint credit_overrides_has_reason check (reason <> ''),
  add constraint credit_overrides_amounts_sane check (exposure >= 0 and credit_limit >= 0);

/*
  A POD belongs to the job whose container it names.

  `equipment_id` and `job_id` are independent columns, so a foreign key cannot
  say it: nothing stops a delivery on job A citing a container stuffed on job
  B. That mis-files the evidence under the wrong shipment, which is discovered
  exactly when somebody needs it. The same shape as 0012's consolidation branch
  check and 0018's match branch check.
*/
create or replace function app.check_pod_equipment() returns trigger
  language plpgsql as $$
declare
  equipment_job uuid;
begin
  if new.equipment_id is null then
    return new;
  end if;

  select job_id into equipment_job from equipment where id = new.equipment_id;

  if equipment_job is distinct from new.job_id then
    raise exception 'The container named on this delivery belongs to a different job'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger proof_of_delivery_equipment_job
  before insert or update of equipment_id, job_id
  on proof_of_delivery
  for each row execute function app.check_pod_equipment();

comment on column free_time_clocks.warned_at is
  'When the operator was warned this clock was about to start charging. Set once — a warning that repeats nightly is a warning that gets filtered out of an inbox.';

-- --------------------------------------------------------------------------
-- Row-level security, grants, audit
-- --------------------------------------------------------------------------

/*
  Proof of delivery: job-derived, with the visibility flag.

  Exactly `job_milestones` and `exceptions` from 0004 — the `exists` is subject
  to `jobs_scope`, so the branch, customer and agent arms are inherited rather
  than restated and cannot drift from them. The agent arm matters here and is
  not incidental: the delivery agent is frequently the party that captured the
  POD, and a portal that will not show them what they just submitted is a
  portal they stop using.
*/
alter table proof_of_delivery enable row level security;
alter table proof_of_delivery force  row level security;

create policy proof_of_delivery_scope on proof_of_delivery using (
  exists (select 1 from jobs j where j.id = proof_of_delivery.job_id)
  and (app.is_internal() or customer_visible)
);

create policy proof_of_delivery_support_read on proof_of_delivery for select using (
  app.is_support() and exists (select 1 from jobs j where j.id = proof_of_delivery.job_id)
);

grant select, insert, update on proof_of_delivery to app_user;
select app.attach_audit('proof_of_delivery');

/*
  The photographs inherit from the POD, which inherits from the job.

  Two hops rather than joining `jobs` directly, so a POD withheld from a
  customer takes its photographs with it. Restating the job predicate here
  would let the two disagree the moment `customer_visible` is cleared.
*/
alter table pod_photos enable row level security;
alter table pod_photos force  row level security;

create policy pod_photos_scope on pod_photos using (
  exists (select 1 from proof_of_delivery p where p.id = pod_photos.pod_id)
);

create policy pod_photos_support_read on pod_photos for select using (
  app.is_support() and exists (select 1 from proof_of_delivery p where p.id = pod_photos.pod_id)
);

grant select, insert, update on pod_photos to app_user;
select app.attach_audit('pod_photos');

/*
  Credit overrides: internal, branch-scoped, and no external arm at all.

  Not an omission — see the header. The customer must not read it and an agent
  has no interest in it. The branch arm is the point: a Doha manager releasing
  a Doha shipment has not spoken for Kuwait's exposure to the same customer,
  and the policy is what makes that structural rather than a convention.
*/
alter table credit_overrides enable row level security;
alter table credit_overrides force  row level security;

create policy credit_overrides_scope on credit_overrides using (
  case
    when app.principal_type() = 'system'   then true
    when app.principal_type() = 'internal' then branch_id = any(app.branch_ids())
    else false
  end
);

create policy credit_overrides_support_read on credit_overrides for select using (
  app.support_sees_branch(credit_overrides.branch_id)
);

create policy credit_overrides_support_write on credit_overrides for update
  using      (app.support_may_write() and app.support_sees_branch(credit_overrides.branch_id))
  with check (app.support_may_write() and app.support_sees_branch(credit_overrides.branch_id));

grant select, insert, update on credit_overrides to app_user;
select app.attach_audit('credit_overrides');
