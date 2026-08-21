-- The assistant's conversations: private to their author, audited like anything else.
--
-- The only tables in this schema whose policy narrows on the *principal*
-- rather than on the branch, and the reason is worth stating because it is a
-- deliberate departure.
--
-- Everything else here is a record of the business, and a colleague in the
-- same branch is entitled to see it — that is what `app.branch_ids()` encodes.
-- A half-finished question to an assistant is not a record of the business. It
-- is somebody thinking out loud, and an inbox that showed everyone's would
-- stop people using it honestly, which would be a worse outcome than the
-- privacy loss it prevents.
--
-- The branch arm is still *and*-ed on, not replaced. A principal's branch
-- roles can be revoked, and revocation must take effect on their next request
-- (`principal_branch_roles.is_active` says so) — so a thread in a branch they
-- no longer hold must stop being readable even though they wrote it.

alter table assistant_threads enable row level security;
alter table assistant_threads force  row level security;

create policy assistant_threads_scope on assistant_threads using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then principal_id = app.principal_id()
                     and branch_id = any(app.branch_ids())
    else false
  end);

alter table assistant_messages enable row level security;
alter table assistant_messages force  row level security;

-- `principal_id` is carried on the message rather than joined from the thread,
-- and this policy is why: a policy that queried `assistant_threads` would make
-- the two mutually recursive, which PostgreSQL rejects outright. The same
-- reasoning as `job_partners` in 0004.
create policy assistant_messages_scope on assistant_messages using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then principal_id = app.principal_id()
                     and branch_id = any(app.branch_ids())
    else false
  end);

-- --------------------------------------------------------------------------
-- A message belongs to its own thread's author
-- --------------------------------------------------------------------------
--
-- The policy above trusts `assistant_messages.principal_id`, so nothing in the
-- policy itself stops a row being written with somebody else's id against a
-- thread they do not own — it would simply become invisible to its author and
-- visible to the impersonated one.
--
-- That is not reachable through the application, which writes both rows in one
-- transaction from one resolved session. It is reachable through a migration,
-- a fix applied against psql, or a future code path that takes the thread id
-- from a request body. A trigger closes it at the boundary, where the
-- application cannot be the only thing enforcing it.
create or replace function app.assistant_message_matches_thread()
returns trigger language plpgsql as $$
declare owner uuid; owner_branch uuid;
begin
  select principal_id, branch_id into owner, owner_branch
    from assistant_threads where id = new.thread_id;

  if owner is null then
    raise exception 'assistant_messages.thread_id % does not exist', new.thread_id;
  end if;
  if owner <> new.principal_id or owner_branch <> new.branch_id then
    raise exception 'an assistant message must carry its thread''s own principal and branch';
  end if;

  return new;
end $$;

create trigger assistant_messages_match_thread
  before insert or update on assistant_messages
  for each row execute function app.assistant_message_matches_thread();

-- --------------------------------------------------------------------------
-- Audit
-- --------------------------------------------------------------------------
--
-- Attached like every other business table (§5), and worth being explicit
-- about what it means here: the trail carries the text of every question and
-- answer, so `audit_log` accumulates a second copy of each conversation.
--
-- The same trade `0027` makes for sealed mailbox passwords and `0031` for
-- prompts, and it lands the same way. These rows are written once and never
-- edited, so the audit is one row at insert and nothing after — and the
-- question it exists to answer is whether anything *changed* the record of
-- what was asked, which is exactly the question a conversation with a machine
-- most needs to be able to answer six months later.
select app.attach_audit('assistant_threads');
select app.attach_audit('assistant_messages');
