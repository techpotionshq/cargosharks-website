-- Mailboxes: tenancy, audit, and one guard the application cannot enforce.
--
-- `mailboxes` holds the IMAP credentials FR-EQ-02's intake reads, one row per
-- office. Shape 1 from 0004_rls.sql — internal-only and branch-scoped — with
-- `branch_id` not null, so there is no "unscoped configuration row" arm to
-- write: a mailbox belongs to exactly one legal entity, because the enquiries
-- that arrive in it do.
--
-- No customer or partner arm, deliberately. A customer contact reaching this
-- table would be reading the credentials of the desk that serves them.

alter table mailboxes enable row level security;
alter table mailboxes force  row level security;

create policy mailboxes_scope on mailboxes using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then branch_id = any(app.branch_ids())
    else false
  end);

-- --------------------------------------------------------------------------
-- Sealed, and checked here rather than only in TypeScript
-- --------------------------------------------------------------------------
--
-- `password_sealed` is AES-256-GCM ciphertext produced by `sealSecret` in
-- `packages/db/src/secrets.ts`, and the format is `v1:<iv>:<tag>:<body>`.
--
-- The constraint exists because the failure it prevents is silent and
-- expensive. A code path that wrote the plaintext password into this column —
-- a migration script, a seed, a fix applied at 2am against psql — would work
-- perfectly: the poll would connect, mail would arrive, and nothing would look
-- wrong until somebody read a backup. A row that cannot be plaintext by
-- construction cannot be plaintext by accident.
--
-- It checks the shape, not the cryptography; the database has no key and is
-- not meant to. Shape is enough to catch every way this goes wrong in practice.
alter table mailboxes add constraint mailboxes_password_sealed_format
  check (password_sealed ~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$');

-- --------------------------------------------------------------------------
-- Audit
-- --------------------------------------------------------------------------
--
-- Attached like every other business table (§5). Worth stating what that means
-- here: the trail records `password_sealed`, so `audit_log` accumulates old
-- ciphertexts and they outlive a key rotation.
--
-- That is the right trade rather than an oversight. The alternative — teaching
-- `app.audit` to drop columns — would put a per-column exception list in the
-- one mechanism whose value comes from having none, and what is retained is
-- ciphertext: useless without a key that was never in the database. "Who
-- changed the Dubai mailbox, and when" is a question worth being able to
-- answer after an incident.
select app.attach_audit('mailboxes');
