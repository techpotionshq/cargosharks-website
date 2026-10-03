-- D3: mark default notification templates an administrator has already edited,
-- so the boot sync (which refreshes only uncustomised rows) keeps their wording.
-- The column itself is added by 0063, generated from the schema.

-- Backfill: a default row whose subject or body a person (anything but the
-- system principal, which is what the seed and the boot sync run as) has
-- changed is customised from the last such change. Read from the audit trail,
-- because that is the only record of who wrote a row before this column.
update notification_templates t
   set customised_at = a.at
  from (
    select row_id, max(at) as at
      from audit_log
     where table_name = 'notification_templates'
       and op = 'UPDATE'
       and coalesce(principal_type, 'system') <> 'system'
       and (before ->> 'subject' is distinct from after ->> 'subject'
            or before ->> 'body' is distinct from after ->> 'body')
     group by row_id
  ) a
 where a.row_id = t.id::text
   and t.branch_id is null
   and t.customised_at is null;
