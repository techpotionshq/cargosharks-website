-- Whether an event sends on a channel at all — FR-NT-01, FR-NT-03.
--
-- Shape 4, configuration (see 0004_rls.sql): read by everyone, written by
-- administrators. The table itself was created in 0032 rather than here, which
-- is an accident of two people generating migrations minutes apart and not
-- worth unpicking — the DDL is correct wherever it sits, and rewriting a
-- generated migration to move one statement would invalidate the snapshot
-- chain behind it.
--
-- ## Why the read is unconditional
--
-- The dispatcher reads this as `systemActor()` on every run, and the settings
-- screen reads it as whoever is signed in. `for select using (true)` covers
-- both without enumerating them, and it is what `notification_templates` — the
-- table this one governs — already does. Nothing here is a secret: it is a
-- list of which messages are switched on, sitting beside a world-readable
-- table containing the messages themselves.
--
-- The alternative was to narrow the read to `admin.reference.write` and let
-- the system actor through separately. That would have been strictly worse: a
-- policy the dispatcher can fall outside of is a policy that silences every
-- notification in the product the first time somebody gets the condition
-- wrong, and it would do it quietly, because a row that RLS hides is
-- indistinguishable from a row that does not exist. Absence means *on* in
-- `channelDecision`, so an over-tight read policy fails safe here by luck
-- rather than by design — and relying on that is how the luck runs out.
--
-- ## Written by the same permission that edits the wording
--
-- `admin.reference.write`, matching `notification_templates` and matching what
-- `/settings/notifications` already asserts. "Reword this" and "stop sending
-- this" are the same person's job on the same screen; splitting them across
-- two permissions would mean an administrator who can silence a notification
-- but not fix the sentence that made them want to.

alter table notification_channel_settings enable row level security;
alter table notification_channel_settings force  row level security;

create policy notification_channel_settings_read on notification_channel_settings
  for select using (true);

create policy notification_channel_settings_write on notification_channel_settings
  for all
  using (app.has_permission('admin.reference.write'))
  with check (app.has_permission('admin.reference.write'));

-- Turning a customer's notifications off is exactly the kind of change that
-- gets asked about six months later, and `updated_at` alone cannot say who.
select app.attach_audit('notification_channel_settings');
