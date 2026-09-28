-- WhatsApp numbers: tenancy and audit — the mirror of 0027_mailboxes_policy.sql.
--
-- `whatsapp_numbers` maps a Kapso/Meta business number (`phone_number_id`) to
-- the branch whose enquiries arrive on it, exactly as `mailboxes` maps an IMAP
-- address to a branch. Shape 1 from 0004_rls.sql — internal-only and
-- branch-scoped — with `branch_id` not null, so there is no "unscoped
-- configuration row" arm: a number belongs to exactly one legal entity, because
-- the enquiries that arrive on it do.
--
-- No customer or partner arm, deliberately, and for the same reason mailboxes
-- has none: a customer contact reaching this table would be reading which desk
-- serves them and on what number. The inbound webhook resolves the branch under
-- `systemActor`, which the `system` arm covers, before any narrower actor runs.
--
-- No sealed-secret constraint, unlike mailboxes: there is no credential on the
-- row. Kapso holds the number and the WhatsApp session, and the one secret that
-- opens the account is the `whatsapp` integration key, sealed there once.

alter table whatsapp_numbers enable row level security;
alter table whatsapp_numbers force  row level security;

create policy whatsapp_numbers_scope on whatsapp_numbers using (
  case app.principal_type()
    when 'system'   then true
    when 'internal' then branch_id = any(app.branch_ids())
    else false
  end);

-- --------------------------------------------------------------------------
-- Audit
-- --------------------------------------------------------------------------
--
-- Attached like every other business table (§5). The 0003 loop ran once over
-- the tables that existed then and does not revisit, so a new table says so
-- itself. "Who pointed the DXB number at the KWI branch, and when" is a
-- question worth being able to answer after a message lands in the wrong queue.
select app.attach_audit('whatsapp_numbers');
