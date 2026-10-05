-- R1 (live run 5): a priced line in an agent's rate reply that the model
-- cannot match to a charge type is kept under `other` instead of being
-- dropped from the total. `UNCLASSIFIED_CHARGE` in core names the key.
--
-- A reference row, so `db:seed` carries it for new deployments. This adds it
-- to databases seeded before it existed: the service runs migrations at
-- deploy but never the seed. `on conflict do nothing` leaves an
-- administrator's own `other` row, renamed or remapped, exactly as it is.
--
-- Runs as the system principal for the reason 0050 gives: `charge_types` is
-- under forced row level security and `app_migrator` holds no BYPASSRLS. The
-- audit trigger records the insert against that principal.

select set_config('app.principal_id', '00000000-0000-7000-8000-000000000000', true),
       set_config('app.principal_type', 'system', true),
       set_config('app.branch_ids', '', true),
       set_config('app.customer_id', '', true),
       set_config('app.partner_id', '', true),
       set_config('app.ip', '', true);

-- The tolerance is the seed's for category `other` (absolute 1, no percent),
-- so a database migrated here holds the same row a fresh seed writes.
insert into charge_types (key, name_en, name_ar, default_basis, category, sort_order,
                          variance_tolerance_percent, variance_tolerance_absolute)
select 'other', 'Other charge', 'رسوم أخرى', 'flat', 'other',
       coalesce((select max(sort_order) from charge_types), 0) + 10, 0, 1
on conflict (key) do nothing;
