-- D3: an administrator's wording of a default notification template survives a deploy.
--
-- The template editor saves the default (`branch_id` null) row in place, and the
-- service's boot sync refreshed every default row to the shipped copy, so each
-- restart put the administrator's sentence back. `customised_at` marks a row a
-- person has saved; the sync refreshes only rows where it is null.
alter table notification_templates add column customised_at timestamptz;

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
