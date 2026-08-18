-- Consolidation — many house bills under one master, and the cost split
-- between them.
--
-- `jobs` carries `master_bill_number` and `house_bill_number` as two columns
-- on one row, which says: one job, one house bill, one master bill. That is
-- exactly right for FCL and for customs brokerage, and it cannot represent the
-- thing an LCL or air consolidator does every week — twenty shippers under one
-- master bill, one ocean freight cost, and a groupage margin that only exists
-- if that cost is split correctly.
--
-- ## Why a new table rather than more columns on `jobs`
--
-- The master-level facts — the master bill, the carrier, the vessel and voyage,
-- the sailing — belong to the consolidation and are *shared* by every house
-- under it. Left on `jobs` they are copied twenty times, and the twenty-first
-- edit disagrees with the other twenty. A vessel does not sail per house.
--
-- So a consolidation is its own row, and a job points at it. A job with no
-- consolidation is unchanged in every respect, which is the point: nothing
-- about FCL work has to know this exists.
--
-- ## Why allocated costs become ordinary charge lines
--
-- The master cost is bought once, at consolidation level, and must land on
-- each house to make per-job profitability true. It could have been a special
-- kind of line that every downstream reader learned about — job P&L, the
-- invoice builder, the accounting export in 0011, the margin report.
--
-- Instead the allocation *writes ordinary `charge_lines`* on each house job,
-- carrying `source_kind = 'consol_allocation'` and `source_id` pointing back
-- at the master line. Those two columns have existed since 0000 for precisely
-- this shape of thing. So nothing downstream changes, and the answer to "why
-- is there a 62.400 KWD ocean freight cost on this house?" is one join away.

create sequence if not exists consol_reference_seq start 1;
grant usage, select on sequence consol_reference_seq to app_user;

create type consolidation_status as enum ('open', 'closed', 'cancelled');

/*
  How a master cost is divided.

  Every basis here is a number the system already holds per house, which is
  what makes the allocation auditable rather than negotiable:

    chargeable_weight  air, and LCL where the rate is per revenue ton
    volume             LCL, the ordinary case — CBM
    gross_weight       where the carrier billed on weight
    packages           rare, and occasionally what the co-loader used
    equal              a flat cost with no sensible driver: customs entry fees
    manual             the operator states each share; the engine checks they
                       sum to the whole and refuses if they do not
*/
create type allocation_basis as enum (
  'chargeable_weight', 'volume', 'gross_weight', 'packages', 'equal', 'manual'
);

create table consolidations (
  id                  uuid primary key default uuidv7(),
  reference           text not null unique,
  branch_id           uuid not null references branches (id),
  status              consolidation_status not null default 'open',
  mode                transport_mode not null,
  trade_direction     trade_direction not null,

  /* The master bill is the consolidation's, not any house's. */
  master_bill_number  text,
  booking_number      text,
  carrier_partner_id  uuid references partners (id),
  /*
    The co-loader, where we bought space rather than sold it.

    A forwarder is on one side or the other of every consolidation and the
    difference is the whole commercial point: co-loading *in* means our master,
    our margin, their house; co-loading *out* means somebody else's master. The
    partner is recorded either way and the direction is read from whether we
    hold the master bill.
  */
  coload_partner_id   uuid references partners (id),

  vessel_name         text,
  voyage_number       text,
  flight_number       text,
  origin_id           uuid references locations (id),
  destination_id      uuid references locations (id),
  etd                 timestamptz,
  eta                 timestamptz,
  atd                 timestamptz,
  ata                 timestamptz,

  /* Manifest cut-off: after this the house list is closed and allocable. */
  closed_at           timestamptz,
  cancelled_at        timestamptz,
  cancelled_reason    text,
  owner_id            uuid references principals (id),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index consolidations_branch_idx on consolidations (branch_id, status, etd);
create index consolidations_master_bill_idx on consolidations (master_bill_number);

alter table consolidations
  add constraint consolidations_closed_status check (
    (status = 'closed') = (closed_at is not null)
  );

/*
  The join. Nullable, and that nullability is the compatibility guarantee:
  every existing job keeps working with no consolidation at all.
*/
alter table jobs add column consolidation_id uuid references consolidations (id);
create index jobs_consolidation_idx on jobs (consolidation_id);

comment on column jobs.consolidation_id is
  'The master this house sails under. Null for FCL and for any job that is its own master.';

/*
  A house cannot join a consolidation in another branch.

  Not a foreign key composition, because `jobs.branch_id` and
  `consolidations.branch_id` are independent columns; a trigger is the honest
  way to say it. The failure it prevents is a Dubai house allocated a share of
  a Kuwait master cost, which then appears in the wrong entity's P&L and the
  wrong entity's accounting export.
*/
create or replace function app.check_consolidation_branch() returns trigger
  language plpgsql as $$
declare
  consol_branch uuid;
begin
  if new.consolidation_id is null then
    return new;
  end if;

  select branch_id into consol_branch from consolidations where id = new.consolidation_id;

  if consol_branch is distinct from new.branch_id then
    raise exception 'Job % is in a different branch from consolidation %',
      new.reference, new.consolidation_id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger jobs_consolidation_branch
  before insert or update of consolidation_id, branch_id on jobs
  for each row execute function app.check_consolidation_branch();

-- --------------------------------------------------------------------------
-- Master-level charges
-- --------------------------------------------------------------------------

create table consol_charge_lines (
  id                      uuid primary key default uuidv7(),
  consolidation_id        uuid not null references consolidations (id),
  /*
    Carried, not derived — the same reason `job_partners` carries one. The RLS
    policy below scopes by branch, and reaching into `consolidations` to find
    it would make the two policies mutually recursive and PostgreSQL would
    reject both.
  */
  branch_id               uuid not null references branches (id),

  direction               charge_direction not null,
  charge_type_id          uuid not null references charge_types (id),
  description             text,
  basis                   charge_basis not null,
  quantity                numeric(19, 6) not null default 1,
  rate                    numeric(19, 6) not null,
  amount                  numeric(19, 6) not null,
  currency                text not null references currencies (code),
  fx_rate                 numeric(19, 8) not null default 1,
  fx_rate_at              timestamptz not null default now(),
  amount_base             numeric(19, 6) not null,
  base_currency           text not null references currencies (code),
  counterparty_partner_id uuid references partners (id),

  allocation_basis        allocation_basis not null default 'volume',
  /*
    When the split was posted, and by whom.

    An unallocated master cost is a consolidation that has not been costed
    yet — visible on the screen as work outstanding. Once allocated, the line
    is frozen: changing it would leave twenty house charge lines describing a
    cost that no longer exists, so the routine reverses and re-posts instead.
  */
  allocated_at            timestamptz,
  allocated_by_id         uuid references principals (id),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index consol_charge_lines_consol_idx
  on consol_charge_lines (consolidation_id, direction);

/*
  Manual allocation needs somewhere to put the shares.

  One row per house per manually-split line. Every other basis computes its
  shares from cargo the system already holds, so this table stays empty unless
  somebody overrode it — which is itself the useful signal.
*/
create table consol_allocation_shares (
  id                    uuid primary key default uuidv7(),
  consol_charge_line_id uuid not null references consol_charge_lines (id),
  job_id                uuid not null references jobs (id),
  branch_id             uuid not null references branches (id),
  share_amount          numeric(19, 6) not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index consol_allocation_shares_unique
  on consol_allocation_shares (consol_charge_line_id, job_id);

-- --------------------------------------------------------------------------
-- §5 obligations
-- --------------------------------------------------------------------------

/*
  Internal only, all three.

  A consolidation contains other customers' shipments — the house list is the
  one thing a customer must never be shown, because it names who else shipped
  what on the same vessel. The customer sees their own job, which carries its
  own dates and its own charges. An agent sees jobs through `job_partners`,
  unchanged.
*/
do $$
declare
  t text;
begin
  foreach t in array array['consolidations', 'consol_charge_lines', 'consol_allocation_shares'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy %I on %I using (
        case
          when app.principal_type() = 'system'   then true
          when app.principal_type() = 'internal' then branch_id = any(app.branch_ids())
          else false
        end)
    $f$, t || '_scope', t);

    execute format(
      'create policy %I on %I for select using (app.support_sees_branch(%I.branch_id))',
      t || '_support_read', t, t);

    execute format(
      'create policy %I on %I for update
         using      (app.support_may_write() and app.support_sees_branch(%I.branch_id))
         with check (app.support_may_write() and app.support_sees_branch(%I.branch_id))',
      t || '_support_write', t, t, t);

    execute format('grant select, insert, update on %I to app_user', t);
    perform app.attach_audit(t);
  end loop;
end $$;
