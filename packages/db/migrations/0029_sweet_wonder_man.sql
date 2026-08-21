-- Integration settings: tenancy, sealing, and the two knobs that moved with it.
--
-- `0028` created the table and the columns. This writes the parts Drizzle
-- cannot derive: the policy, the audit trigger, the constraints that keep a
-- plaintext credential out by construction, and the backfill that makes the
-- whole change a no-op for a deployment already running.

-- --------------------------------------------------------------------------
-- The policy — a fifth shape, and the reason it is not one of the four
-- --------------------------------------------------------------------------
--
-- `0004_rls.sql` sorts tables into four shapes. `integration_settings` is
-- nearly Shape 4 (configuration: read by everyone, written by administrators)
-- and must not be, for one reason: Shape 4 is readable with `using (true)`
-- because the engines need it — a customer's quote PDF reads the currency's
-- minor units. Nothing renders an SMTP password.
--
-- So this is Shape 4 with the read arm closed to the same key as the write
-- arm. Not because the ciphertext is dangerous on its own — it is useless
-- without a key that is not in the database — but because `settings` is not
-- sealed, and the host names, gateway paths and account identifiers in it are
-- a map of this operator's suppliers. A coordinator has no call to read it.
--
-- There is no branch arm because there is no `branch_id`. That is the honest
-- shape of the thing: one SMTP relay and one Maersk registration serve every
-- office, so "which branches may see it" has no answer and the permission is
-- the whole of the scoping.

alter table integration_settings enable row level security;
alter table integration_settings force  row level security;

create policy integration_settings_scope on integration_settings for all
  using (
    app.is_system()
    or (app.principal_type() = 'internal'
        and app.has_permission('admin.integrations.write'))
  )
  with check (
    app.is_system()
    or (app.principal_type() = 'internal'
        and app.has_permission('admin.integrations.write'))
  );

-- --------------------------------------------------------------------------
-- Sealed, checked in the database
-- --------------------------------------------------------------------------
--
-- The same argument as `mailboxes_password_sealed_format` in `0027`, against
-- the same silent failure: a script, a seed or a 2am fix applied straight
-- through psql that writes a plaintext key into this column would work
-- perfectly. Mail would send, the carrier would answer, and nothing would look
-- wrong until somebody read a backup.
--
-- `secrets` is an object rather than a single column, so the check has to hold
-- for every value in it — and a CHECK constraint may not contain a subquery,
-- which rules out the obvious `jsonb_each_text` formulation. An immutable
-- function is the way to say it. It reads only its argument, so `immutable` is
-- true rather than merely asserted.
create or replace function app.all_sealed(payload jsonb) returns boolean
  language sql immutable parallel safe as $$
    select coalesce(bool_and(value ~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'), true)
    from jsonb_each_text(payload)
  $$;

alter table integration_settings add constraint integration_settings_secrets_sealed
  check (jsonb_typeof(secrets) = 'object' and app.all_sealed(secrets));

-- `settings` holds no credential and is not sealed, so the only thing worth
-- asserting is that it is an object — a bare string or array here would be
-- read back as `undefined` fields by every consumer and look like a row that
-- had never been configured.
alter table integration_settings add constraint integration_settings_settings_object
  check (jsonb_typeof(settings) = 'object');

-- --------------------------------------------------------------------------
-- Quiet hours: a window, not two loose numbers
-- --------------------------------------------------------------------------
--
-- FR-NT-07's window wraps midnight (21 to 7), so the usual `from < to` is
-- wrong here and the only genuinely broken value is the degenerate one.
-- `from = to` is a window of either zero hours or twenty-four depending on
-- which way the dispatcher's comparison happens to fall, and both readings are
-- defensible — which is exactly why it must not be storable. An administrator
-- who wants no quiet hours clears the switch.
alter table branches add constraint branches_quiet_hours_window
  check (
    quiet_hours_from_hour between 0 and 23
    and quiet_hours_to_hour between 0 and 23
    and quiet_hours_from_hour <> quiet_hours_to_hour
  );

alter table mailboxes add constraint mailboxes_poll_limits
  check (poll_batch between 1 and 500 and max_attachment_mb between 1 and 200);

-- --------------------------------------------------------------------------
-- Backfill — this migration changes no behaviour on a running deployment
-- --------------------------------------------------------------------------
--
-- `FX_QUOTE_CURRENCIES` defaulted to ten codes and the refresh worker
-- intersected them with this table before writing anything. Marking exactly
-- the currencies that both lists already agreed on reproduces yesterday's
-- behaviour precisely: no currency starts being fetched that was not being
-- fetched before, and none stops.
--
-- A deployment that had narrowed the variable by hand gets the wider default
-- back for whichever of those ten it also has rows for. That is the one
-- behaviour change available here and it is the safe direction — a rate
-- fetched and unused costs one row, where a rate missing at invoice time costs
-- a manual entry and an argument about which day's rate applied.
update currencies
   set is_tracked = true
 where is_active
   and code in ('USD', 'AED', 'EUR', 'GBP', 'SAR', 'QAR', 'BHD', 'OMR', 'INR', 'CNY');

-- --------------------------------------------------------------------------
-- Audit
-- --------------------------------------------------------------------------
--
-- Attached like every other business table (§5), and worth stating what it
-- means here for the same reason `0027` stated it: the trail records `secrets`,
-- so `audit_log` accumulates superseded ciphertexts that outlive a key
-- rotation. That is the trade `0027` already made and the reasoning has not
-- changed — teaching `app.audit` a per-column exception list would put a
-- carve-out in the one mechanism whose value is having none, and what is kept
-- is useless without a key the database has never held.
--
-- "Who pointed our tracking at a different gateway, and when" is a question
-- worth being able to answer, and it is a better question here than on
-- mailboxes: this table is where somebody redirects an integration.
select app.attach_audit('integration_settings');
