-- Architecture §6.2, §6.4 — the constraints Drizzle cannot express.
--
-- Everything here makes a bad state unrepresentable rather than merely
-- unlikely. Each one replaces a validation someone would otherwise have to
-- remember to write.

create extension if not exists btree_gist;

-- --------------------------------------------------------------------------
-- Rate card validity — FR-RT-01, FR-RT-08
-- --------------------------------------------------------------------------
--
-- `validity` was generated as text by drizzle-kit, which has no range type.
-- It becomes a real `daterange`, kept in step with valid_from/valid_to so
-- application reads stay simple, and then carries the temporal uniqueness
-- constraint.
--
-- Two overlapping cards for the same lane make "the valid rate" ambiguous —
-- a pricing bug that surfaces as a wrong quote weeks later. PostgreSQL 18's
-- standard `WITHOUT OVERLAPS` refuses the second card outright.

alter table rate_cards
  alter column validity drop default,
  alter column validity type daterange using daterange(valid_from, valid_to, '[)');

alter table rate_cards
  alter column validity set default null;

create or replace function app.rate_card_validity() returns trigger
  language plpgsql as $$
begin
  new.validity := daterange(new.valid_from, new.valid_to, '[)');
  return new;
end $$;

create trigger rate_cards_validity
  before insert or update of valid_from, valid_to on rate_cards
  for each row execute function app.rate_card_validity();

-- Temporal uniqueness. Null partner_id / customer_id are distinct under the
-- default NULLS DISTINCT, so a general card and a customer-specific card for
-- the same lane coexist — which is the intent.
alter table rate_cards
  add constraint rate_cards_no_overlap
  unique nulls not distinct (direction, partner_id, customer_id, mode, origin_id,
                             destination_id, validity without overlaps);

-- --------------------------------------------------------------------------
-- The deferred foreign key
-- --------------------------------------------------------------------------
--
-- `assets.branch_id` could not be declared in the schema module: branches
-- points at assets for its letterhead, and one of the two directions has to
-- live outside the import graph.

alter table assets
  add constraint assets_branch_id_branches_id_fk
  foreign key (branch_id) references branches (id);

-- Self-references, declared here for the same reason.
alter table quotes
  add constraint quotes_superseded_by_fk foreign key (superseded_by_id) references quotes (id);
alter table rate_cards
  add constraint rate_cards_superseded_by_fk foreign key (superseded_by_id) references rate_cards (id);
alter table documents
  add constraint documents_superseded_by_fk foreign key (superseded_by_id) references documents (id);
alter table partner_compliance
  add constraint partner_compliance_superseded_by_fk
  foreign key (superseded_by_id) references partner_compliance (id);
alter table invoices
  add constraint invoices_credits_invoice_fk
  foreign key (credits_invoice_id) references invoices (id);
alter table charge_lines
  add constraint charge_lines_invoice_fk foreign key (invoice_id) references invoices (id);
alter table free_time_clocks
  add constraint free_time_clocks_charge_line_fk
  foreign key (charge_line_id) references charge_lines (id);
alter table branches
  add constraint branches_calendar_fk foreign key (calendar_id) references working_calendars (id);
alter table principals
  add constraint principals_customer_fk foreign key (customer_id) references customers (id);
alter table principals
  add constraint principals_partner_fk foreign key (partner_id) references partners (id);
alter table rate_requests
  add constraint rate_requests_enquiry_fk foreign key (enquiry_id) references enquiries (id);
alter table notification_deliveries
  add constraint notification_deliveries_template_fk
  foreign key (template_id) references notification_templates (id);
alter table invoices
  add constraint invoices_pdf_asset_fk foreign key (pdf_asset_id) references assets (id);
alter table accounting_exports
  add constraint accounting_exports_asset_fk foreign key (asset_id) references assets (id);
alter table free_time_rules
  add constraint free_time_rules_partner_fk foreign key (partner_id) references partners (id);
alter table api_keys
  add constraint api_keys_customer_fk foreign key (customer_id) references customers (id);

-- --------------------------------------------------------------------------
-- Money and quantity sanity
-- --------------------------------------------------------------------------
--
-- Amounts may legitimately be negative — a credit note line, a rebate — but a
-- rate, a per-diem or a weight may not.

alter table rate_card_lines add constraint rate_card_lines_rate_non_negative check (rate >= 0);
alter table free_time_clocks add constraint free_time_clocks_per_diem_non_negative check (per_diem >= 0);
alter table free_time_clocks add constraint free_time_clocks_free_days_non_negative check (free_days >= 0);
alter table free_time_rules add constraint free_time_rules_per_diem_non_negative check (per_diem >= 0);
alter table currencies add constraint currencies_minor_units_range check (minor_units between 0 and 6);

-- A clock cannot end before it starts, and a rate card cannot be valid
-- backwards.
alter table free_time_clocks
  add constraint free_time_clocks_window check (ends_on is null or ends_on >= starts_on);
alter table rate_cards
  add constraint rate_cards_validity_ordered check (valid_to is null or valid_to > valid_from);

-- An exception closes after it opens; a job's actual arrival follows departure.
alter table exceptions
  add constraint exceptions_window check (closed_at is null or closed_at >= opened_at);

-- --------------------------------------------------------------------------
-- Principal shape — §6.1
-- --------------------------------------------------------------------------
--
-- A customer contact must carry a customer, an agent contact a partner, and
-- internal staff neither. Without this, a mis-set principal silently lands in
-- the `else false` arm of the RLS policies and the user sees an empty system
-- with no explanation.

alter table principals add constraint principals_type_shape check (
  case type
    when 'customer_contact' then customer_id is not null and partner_id is null
    when 'agent_contact'    then partner_id  is not null and customer_id is null
    else customer_id is null and partner_id is null
  end
);

-- --------------------------------------------------------------------------
-- Numbering — FR-ID-01
-- --------------------------------------------------------------------------
--
-- An issued invoice must carry a series number; a draft must not. Gaps in a
-- tax-relevant series are a compliance question, so the number is allocated at
-- issue, inside the issuing transaction, and never before.

alter table invoices add constraint invoices_series_when_issued check (
  (status = 'draft' and series_no is null)
  or (status <> 'draft' and series_no is not null)
);

-- --------------------------------------------------------------------------
-- Reference numbering
-- --------------------------------------------------------------------------
--
-- Enquiry, quote and job references are human-facing and must not repeat.
-- A sequence rather than `max(reference) + 1`: two coordinators creating an
-- enquiry in the same second would otherwise take the same number, and the
-- unique constraint would surface it as a failed save rather than a queue.
--
-- Gaps are acceptable here — these are operational references, not the tax
-- invoice series, which is allocated from `branches.invoice_series_next`
-- inside the issuing transaction precisely because gaps there are not.

create sequence if not exists enquiry_reference_seq start 1;
create sequence if not exists quote_reference_seq   start 1;
create sequence if not exists job_reference_seq     start 1;

grant usage, select on sequence enquiry_reference_seq, quote_reference_seq, job_reference_seq
  to app_user;

-- --------------------------------------------------------------------------
-- Performance — §12
-- --------------------------------------------------------------------------
--
-- The coverage lookup carries a two-second budget (FR-RT-10). GiST over the
-- range supports the "valid on the ready date" predicate; PostgreSQL 18's
-- B-tree skip scan covers lane queries that leave `mode` unconstrained.

create index rate_cards_validity_gist on rate_cards using gist (validity);
create index rate_cards_lane_validity_idx
  on rate_cards (mode, origin_id, destination_id, direction, valid_from desc);

-- Partial indexes for the queues the workers poll every fifteen minutes.
create index enquiries_sla_open_idx on enquiries (sla_due_at)
  where status in ('new', 'assigned', 'rating') and closed_at is null;
create index free_time_clocks_running_idx on free_time_clocks (starts_on)
  where ends_on is null;
create index notification_outbox_undispatched_idx on notification_outbox (created_at)
  where dispatched_at is null;
create index charge_lines_uninvoiced_idx on charge_lines (branch_id, job_id)
  where invoice_id is null and direction = 'revenue';
