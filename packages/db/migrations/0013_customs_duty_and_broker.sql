-- Customs — owning the half of the work that is ours.
--
-- The filing itself is not available to us and will not become available by
-- being planned for. Kuwait customs runs on MicroClear under a build-operate-
-- transfer concession held by Global Clearinghouse Systems — a joint venture
-- majority-owned by Agility — which runs to 2030. Access is gated by a
-- concessionaire owned by a competitor. `adapters/customs.ts` says this at
-- length and refuses to pretend otherwise, which is right.
--
-- What was wrong was concluding from that that customs is outside the system.
-- The filing click is thirty seconds. The hours are on either side of it:
--
--   before  somebody reads an invoice, a packing list and a bill of lading and
--           re-types values, weights, package counts, HS codes and references
--           into a declaration screen
--   before  somebody guesses the duty, or does not, and the customer is
--           surprised by the landed cost after the goods have shipped
--   after   somebody chases the broker for the declaration number, then types
--           it back in so the SLA clock and the exception board stop lying
--
-- This migration is the reference data for the middle one and the write path
-- for the third. The first is a document, and is generated from data the
-- system already holds once 0010 gives it cargo lines.

-- --------------------------------------------------------------------------
-- Duty rates
-- --------------------------------------------------------------------------

/*
  Matched by HS prefix, longest first.

  A tariff is a tree: chapter (2 digits), heading (4), subheading (6), national
  line (8 or 10). A rate is published at whatever depth the exception needs, so
  the lookup is "the most specific prefix of this code that has a row" rather
  than an equality match. The GCC common external tariff is 5% on most things
  with a long list of exemptions — foodstuffs, medicines, books — and those
  exemptions are published at chapter level while the tobacco and alcohol rates
  are national lines. One table holds both because the prefix rule does.

  Per country, because the GCC tariff is common in principle and not in
  practice, and because a UAE deployment must not read Kuwait's exemptions.
*/
create table duty_rates (
  id             uuid primary key default uuidv7(),
  country        text not null references countries (code),
  hs_prefix      text not null,
  rate_percent   numeric(19, 6) not null,
  description_en text not null,
  description_ar text,
  /*
    A rate is a fact about a date. An estimate produced in January must be
    reproducible in June even if the tariff moved in March, so the row is
    dated rather than edited.
  */
  effective_from date not null,
  effective_to   date,
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index duty_rates_lookup_idx on duty_rates (country, hs_prefix, effective_from);

create unique index duty_rates_unique_period
  on duty_rates (country, hs_prefix, effective_from);

alter table duty_rates
  add constraint duty_rates_prefix_digits check (hs_prefix ~ '^[0-9]{2,10}$');
alter table duty_rates
  add constraint duty_rates_rate_sane check (rate_percent >= 0 and rate_percent <= 100);
alter table duty_rates
  add constraint duty_rates_period_ordered check (effective_to is null or effective_to > effective_from);

-- --------------------------------------------------------------------------
-- What the estimate produced, kept beside what the broker came back with
-- --------------------------------------------------------------------------

/*
  `customs_stages.duty_amount` is what was actually assessed. These are what we
  told the customer to expect, and keeping both is the entire point: the gap
  between them is the only honest measure of whether the estimate is worth
  quoting. A single column would be overwritten by the truth and the question
  could never be asked again.
*/
alter table customs_stages add column customs_value        numeric(19, 6);
alter table customs_stages add column customs_value_currency text references currencies (code);
alter table customs_stages add column estimated_duty_amount numeric(19, 6);
alter table customs_stages add column estimated_at          timestamptz;
alter table customs_stages add column estimate_basis        jsonb;

comment on column customs_stages.estimate_basis is
  'The HS lines, rates and values the estimate was built from - so a disputed number can be explained without recomputing it against a tariff that has since moved.';

-- --------------------------------------------------------------------------
-- The broker writes back, without an operator in the middle
-- --------------------------------------------------------------------------

/*
  A customs broker is already a partner on the job — `job_partners.role` and
  `customs_stages.broker_partner_id` both say so — and already has a principal
  type that can sign in (`agent_contact`). What they could not do is record the
  declaration, so the number arrived by email or WhatsApp and an operator typed
  it in, which is a delay measured in hours on a clock measured in hours.

  The policy is deliberately narrow: it names the broker of *this customs
  stage*, not any partner on the job. A trucker on the same shipment gains
  nothing from this.

  0004's `customs_stages_scope` is a permissive `for all` policy and stays
  exactly as it was; permissive policies are OR-ed, so this adds a path and
  removes none. The columns the broker may actually change are constrained by
  the server action, not here — a policy governs rows, and this row is one the
  broker legitimately owns a part of.
*/
create policy customs_stages_broker_write on customs_stages for update
  using (
    app.principal_type() = 'agent_contact'
    and broker_partner_id = app.partner_id()
    and exists (select 1 from jobs j where j.id = customs_stages.job_id)
  )
  with check (
    app.principal_type() = 'agent_contact'
    and broker_partner_id = app.partner_id()
  );

-- --------------------------------------------------------------------------
-- §5 obligations
-- --------------------------------------------------------------------------

/*
  Configuration shape, as `charge_types` and `commodities` are: read by
  everyone who is signed in, written by administrators. A tariff is not a
  tenant's secret — it is published by the state — and the customer portal
  showing "5% duty, GCC common external tariff" beside an estimate is the
  point of holding it.
*/
alter table duty_rates enable row level security;
alter table duty_rates force  row level security;

create policy duty_rates_read on duty_rates for select using (
  app.principal_type() is not null
);

create policy duty_rates_write on duty_rates for all
  using      (app.has_permission('admin.reference.write'))
  with check (app.has_permission('admin.reference.write'));

create policy duty_rates_support_read on duty_rates for select using (app.is_support());

grant select, insert, update on duty_rates to app_user;
select app.attach_audit('duty_rates');
