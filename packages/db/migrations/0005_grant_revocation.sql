-- Revocable branch-role grants — FR-ID-02, FR-ID-08.
--
-- `principal_branch_roles` had no way to express "this person no longer works
-- in Dubai". The row could only be created or re-pointed at a different role,
-- and removing it outright is not available to the application: `app_user`
-- holds no DELETE on any table, which is the mechanism behind §5.5 — records
-- are retired, never erased, so the audit trail cannot be edited by the
-- application that wrote it.
--
-- The consequence was that the only interface offering grant management could
-- add access and could not take it away, which is the wrong half of the
-- feature to ship. This adds the same `is_active` retirement flag every other
-- retirable record in the schema already carries.
--
-- Backfilled to true: every grant that exists today is a live one.

alter table principal_branch_roles
  add column if not exists is_active boolean not null default true;

-- The session lookup joins through this table on every authenticated request
-- and now filters on the flag, so the index it uses has to carry it.
create index if not exists principal_branch_roles_active_idx
  on principal_branch_roles (principal_id, is_active)
  where is_active;

comment on column principal_branch_roles.is_active is
  'False where the grant has been revoked. Revocation takes effect on the '
  'principal''s next request, because session resolution re-reads this rather '
  'than trusting a claim baked into a token (FR-ID-08).';
