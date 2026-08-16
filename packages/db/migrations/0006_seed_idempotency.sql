-- Seed idempotency — the NULL that slips through a unique constraint.
--
-- `pnpm db:seed` is written to be re-runnable: every insert carries
-- `on conflict do nothing`, and the comment above the role grants says so
-- outright. It was not re-runnable, and the failure was silent.
--
-- Three unique constraints include a **nullable** column:
--
--   chargeable_rules_unique       (mode, branch_id)
--   milestone_templates_unique    (mode, direction, service_type, code)
--   notification_templates_unique (event_key, channel, locale, branch_id)
--
-- The seed supplies no branch and no service type, so those columns are NULL
-- on every seeded row. Under PostgreSQL's default `NULLS DISTINCT`, two rows
-- that agree on every other column but hold NULL there do **not** conflict —
-- `NULL = NULL` is unknown, so the index sees two different keys. `on conflict
-- do nothing` therefore never fires, and each run appends a fresh copy of the
-- whole reference set.
--
-- On the shared database this had run five times: 25 rows in
-- `chargeable_rules` where there should be 5, and 215 milestone templates
-- where there should be 43.
--
-- The consequence is not cosmetic. `apps/web/src/features/jobs/form-actions.ts`
-- lays down one `job_milestones` row per template row matching the job's mode
-- and direction, so every job booked against that data got **five copies of
-- every milestone** — which is `FR-JB-03`'s acceptance criterion ("creating a
-- job of each type produces the correct milestone set") failing in production
-- while the seed reported success.
--
-- `rate_cards_no_overlap` in `0002_constraints.sql` already had this right:
-- `unique nulls not distinct (...)`. These three did not.
--
-- Forward-only, and safe to re-run: the deletes are keyed on the duplicate
-- rank, and the constraints are dropped by name before being recreated.

-- ---------------------------------------------------------------------------
-- The actor
-- ---------------------------------------------------------------------------
--
-- These tables carry `force row level security`, and `app_migrator` holds no
-- BYPASSRLS (§5.1) — so it is subject to its own policies even as the owner.
-- The scope policies admit `system`, and the setting is transaction-local, so
-- it cannot survive this migration into a pooled connection.

select set_config('app.principal_id', '00000000-0000-7000-8000-000000000000', true),
       set_config('app.principal_type', 'system', true),
       set_config('app.branch_ids', '', true),
       set_config('app.customer_id', '', true),
       set_config('app.partner_id', '', true),
       set_config('app.ip', '', true);

-- ---------------------------------------------------------------------------
-- De-duplicate, keeping the first row written
-- ---------------------------------------------------------------------------
--
-- `partition by` groups NULLs together — which is exactly the equality the
-- unique index refused to apply, and why the window function can find the
-- duplicates the constraint could not. Ordering by `created_at` then `id`
-- keeps the original and discards the later copies, so any row already
-- referenced elsewhere is the one that survives.

delete from chargeable_rules where id in (
  select id from (
    select id, row_number() over (
      partition by mode, branch_id order by created_at, id
    ) as copy from chargeable_rules
  ) ranked where copy > 1
);

delete from milestone_templates where id in (
  select id from (
    select id, row_number() over (
      partition by mode, direction, service_type, code order by created_at, id
    ) as copy from milestone_templates
  ) ranked where copy > 1
);

delete from notification_templates where id in (
  select id from (
    select id, row_number() over (
      partition by event_key, channel, locale, branch_id order by created_at, id
    ) as copy from notification_templates
  ) ranked where copy > 1
);

-- ---------------------------------------------------------------------------
-- Make NULL mean equal, so `on conflict do nothing` can see the collision
-- ---------------------------------------------------------------------------

alter table chargeable_rules drop constraint if exists chargeable_rules_unique;
alter table chargeable_rules
  add constraint chargeable_rules_unique
  unique nulls not distinct (mode, branch_id);

alter table milestone_templates drop constraint if exists milestone_templates_unique;
alter table milestone_templates
  add constraint milestone_templates_unique
  unique nulls not distinct (mode, direction, service_type, code);

alter table notification_templates drop constraint if exists notification_templates_unique;
alter table notification_templates
  add constraint notification_templates_unique
  unique nulls not distinct (event_key, channel, locale, branch_id);
