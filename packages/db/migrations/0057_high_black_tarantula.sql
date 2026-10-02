-- The intake agent: tenancy and audit for the four tables 0056 created.
--
-- Two shapes from 0004_rls.sql, and the line between them is configuration
-- versus conversation.
--
-- `intake_settings` and `intake_requirements` are the `notification_templates`
-- shape with a branch column: a row with `branch_id` null is the default the
-- seed writes, and a branch row overrides it. Every internal principal may
-- *read* the default and their own branches' rows — the enquiry screen shows
-- why the agent asked what it asked. Writing is narrower: a branch row only,
-- and only by somebody who administers that branch's intake
-- (`admin.mailboxes.write` *in that branch* — the authority that already
-- decides which numbers and mailboxes feed the board). The default row has no
-- internal writer at all; it is vendor copy the seed owns, exactly as the
-- template defaults are.
--
-- `intake_conversations` and `intake_turns` are shape 1, internal-only and
-- branch-scoped. No customer arm, deliberately: the turn log records why the
-- agent stayed silent on a customer — "a person is handling this", "past the
-- clarification cap" — which is internal reasoning, not correspondence.

alter table intake_settings enable row level security;
alter table intake_settings force  row level security;

create policy intake_settings_read on intake_settings for select using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then branch_id is null or branch_id = any(app.branch_ids())
    else false
  end);

create policy intake_settings_write on intake_settings for all
  using (
    app.is_system()
    or (app.is_internal() and branch_id is not null
        and app.has_permission_in('admin.mailboxes.write', branch_id)))
  with check (
    app.is_system()
    or (app.is_internal() and branch_id is not null
        and app.has_permission_in('admin.mailboxes.write', branch_id)));

alter table intake_requirements enable row level security;
alter table intake_requirements force  row level security;

create policy intake_requirements_read on intake_requirements for select using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then branch_id is null or branch_id = any(app.branch_ids())
    else false
  end);

create policy intake_requirements_write on intake_requirements for all
  using (
    app.is_system()
    or (app.is_internal() and branch_id is not null
        and app.has_permission_in('admin.mailboxes.write', branch_id)))
  with check (
    app.is_system()
    or (app.is_internal() and branch_id is not null
        and app.has_permission_in('admin.mailboxes.write', branch_id)));

alter table intake_conversations enable row level security;
alter table intake_conversations force  row level security;

create policy intake_conversations_scope on intake_conversations using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then branch_id = any(app.branch_ids())
    else false
  end);

alter table intake_turns enable row level security;
alter table intake_turns force  row level security;

create policy intake_turns_scope on intake_turns using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then branch_id = any(app.branch_ids())
    else false
  end);

-- --------------------------------------------------------------------------
-- Audit
-- --------------------------------------------------------------------------
--
-- All four, attached here because the 0003 loop ran once and does not revisit.
-- The settings trail answers "who shortened Kuwait's quiet window, and when";
-- the conversation trail answers "who switched the agent off on this
-- customer"; and the turn log is itself an audit of the agent, audited.
select app.attach_audit('intake_settings');
select app.attach_audit('intake_requirements');
select app.attach_audit('intake_conversations');
select app.attach_audit('intake_turns');
