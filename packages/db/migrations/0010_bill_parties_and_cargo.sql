-- Bill parties and cargo lines — the data a document needs and a job did not carry.
--
-- Release One could render exactly one document: the invoice. Everything else
-- a forwarder issues — the house bill, the delivery order, the manifest, the
-- packing list — was a document *type* you could upload a scan of, which is
-- the same as not having it. An operator who types the bill of lading into
-- Word has not been given a system; they have been given a filing cabinet.
--
-- The templates are the easy half. The reason they could not be written is
-- that `jobs` carries a `customer_id` and `job_partners`, and neither answers
-- the question a bill of lading asks:
--
--   who is the *shipper*, printed as they wish to appear
--   who is the *consignee*, which is frequently "TO ORDER" and not a customer
--   who is *notified* on arrival, which is often a third party entirely
--   what are the *marks and numbers*, verbatim, as they appear on the cartons
--
-- None of that is reference data. `commodities.hs_code` classifies cargo for
-- customs; it does not describe it for a carrier. A bill says what the shipper
-- declared, in the shipper's words, and the carrier prints it verbatim — the
-- phrase of art is "said to contain". So it is stored per job, as text, and
-- never resolved through a lookup that would improve it.

-- --------------------------------------------------------------------------
-- Parties
-- --------------------------------------------------------------------------

/*
  A new type, created here, so the 55P04 trap from 0008 does not apply.

  That check refuses a label *added* to a type that predates the transaction.
  A type created and used in the same migration is fine, on a fresh database
  and an existing one alike.
*/
create type bill_party_role as enum (
  'shipper', 'consignee', 'notify', 'second_notify', 'delivery_agent', 'forwarding_agent'
);

create table job_parties (
  id            uuid primary key default uuidv7(),
  job_id        uuid not null references jobs (id),
  role          bill_party_role not null,

  /*
    Optionally *linked*, always *copied*.

    `customer_id` and `partner_id` record where the party came from, so a
    screen can offer "use the customer's details" and an audit can see that it
    was used. The name and address below are still stored on the row.

    That looks like denormalisation and is the opposite of a mistake: a bill of
    lading issued in March must still print in November exactly as it was
    issued, and a customer who moves office in June would otherwise silently
    rewrite the history of every document they appear on. A document is a
    record of what was said, not a view over what is currently true.
  */
  customer_id   uuid references customers (id),
  partner_id    uuid references partners (id),

  name_en       text not null,
  name_ar       text,
  /*
    One text block, newlines preserved, printed as given.

    Not `line_1`/`line_2`/`city`/`postcode`. Addresses across the trades this
    serves — a Kuwaiti industrial plot number, an Indian PIN block, a European
    door number — do not agree on how many parts they have, and a structured
    address that cannot hold one of them gets worked around by putting the
    remainder in the last field. `country` is separate because documents and
    customs both need it as a code.
  */
  address       text,
  city          text,
  country       text references countries (code),

  contact_name  text,
  phone         text,
  email         text,
  /* Consignee tax registration prints on the bill in several jurisdictions. */
  tax_id        text,

  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index job_parties_job_idx on job_parties (job_id, role, sort_order);

/*
  One shipper and one consignee; notify parties may repeat.

  A partial unique index rather than a check constraint, because the rule is
  about the set of rows and not about any one of them. Two consignees is not a
  data-entry variation to be tolerated — it is a bill that cannot be issued.
*/
create unique index job_parties_single_principal
  on job_parties (job_id, role)
  where role in ('shipper', 'consignee');

alter table job_parties
  add constraint job_parties_name_not_blank check (length(btrim(name_en)) > 0);

-- --------------------------------------------------------------------------
-- Cargo
-- --------------------------------------------------------------------------

create table job_cargo (
  id                 uuid primary key default uuidv7(),
  job_id             uuid not null references jobs (id),
  line_no            integer not null default 1,

  /* Verbatim. Newlines preserved — marks are laid out, not written. */
  marks_and_numbers  text,
  package_count      integer,
  /* "CARTONS", "PALLETS", "DRUMS". Free text: the carrier prints what it is given. */
  package_type       text,
  description_en     text not null,
  description_ar     text,
  /* Classification, for the customs pack. Distinct from the description above. */
  hs_code            text,

  gross_weight_kg    numeric(19, 6),
  net_weight_kg      numeric(19, 6),
  volume_cbm         numeric(19, 6),

  /*
    Which container the line is stuffed in, where that is known.

    Nullable because it is unknown at booking and known at stuffing, and
    because an air or LCL line may never have one. A container-level manifest
    groups on this; a bill of lading ignores it.
  */
  equipment_id       uuid references equipment (id),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index job_cargo_line_unique on job_cargo (job_id, line_no);

alter table job_cargo
  add constraint job_cargo_description_not_blank check (length(btrim(description_en)) > 0);
alter table job_cargo
  add constraint job_cargo_packages_positive check (package_count is null or package_count > 0);

-- --------------------------------------------------------------------------
-- What a generated document records about itself
-- --------------------------------------------------------------------------

/*
  `documents` could say what type a file was and who released it, but not
  whether the system produced it or a coordinator uploaded a scan. That
  distinction decides whether "regenerate" is offered, and whether a
  superseding version can be produced at all.
*/
alter table documents add column generated_from text;
alter table documents add column locale locale not null default 'en';

comment on column documents.generated_from is
  'Template key that produced this file - null for an upload. Regeneration is offered only where this is set.';

-- --------------------------------------------------------------------------
-- House bill numbering
-- --------------------------------------------------------------------------

/*
  The same shape as `invoice_series`, and for the same reason: the series is
  per branch, and one global sequence would hand KWI 1, 3, 4 and DXB 2, 5,
  leaving both with a gap they cannot explain.

  Nullable, unlike the invoice series, because a branch that issues no house
  bills should not be made to invent a prefix. Where it is null the number is
  entered by hand, which is what happens today.
*/
alter table branches add column house_bill_series text;
alter table branches add column house_bill_series_next integer not null default 1;

-- --------------------------------------------------------------------------
-- §5 obligations — RLS, audit, grants
-- --------------------------------------------------------------------------

/*
  Job-derived, both of them: a party or a cargo line is visible exactly when
  its job is. The `exists` is itself subject to `jobs_scope`, so this inherits
  the branch, customer and agent arms rather than restating them.

  Deliberately visible to a customer contact and to an agent: both appear on
  the bill of lading the party is entitled to read, and an agent handling the
  cargo at destination needs the marks to identify it.
*/
do $$
declare
  t text;
begin
  foreach t in array array['job_parties', 'job_cargo'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy %I on %I using (exists (select 1 from jobs j where j.id = %I.job_id))
    $f$, t || '_scope', t, t);

    -- The support arm from 0008. Its catalogue loops ran once, when 0008 was
    -- applied, so a table added later must add its own — same predicate.
    execute format($f$
      create policy %I on %I for select using (
        app.is_support() and exists (select 1 from jobs j where j.id = %I.job_id))
    $f$, t || '_support_read', t, t);

    execute format('grant select, insert, update on %I to app_user', t);
    perform app.attach_audit(t);
  end loop;
end $$;
