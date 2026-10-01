-- Sales fixes — pending SQL for the coordinator to turn into migrations.
--
-- Hand-written, so it belongs in a `db:generate:custom` migration (it carries
-- the snapshot forward; nothing here changes the Drizzle-modelled schema).
-- Applied in order, as `app_migrator`. Idempotent where it can be, so applying
-- it twice to a test database is harmless.

-- ---------------------------------------------------------------------------
-- S15 — the rate-card no-overlap key carries the branch
-- ---------------------------------------------------------------------------
--
-- `rate_cards_no_overlap` was unique over (direction, partner, customer, mode,
-- origin, destination, validity) with no `branch_id`. Rate cards are
-- branch-scoped under RLS, so when Kuwait and Dubai both bought from the same
-- agent on the same lane, the second branch's card was refused with 23P01 over
-- a card its own policy hides from it — an error about something it cannot
-- see, with no way to fix it. Two branches' cards for one lane are two
-- separate commercial facts; one branch still cannot hold two overlapping
-- cards for the same counterparty and lane, which is what keeps "the valid
-- rate" unambiguous (and what `promoteRateReply` now ends or refuses, S5).
--
-- Dropped and re-added in one statement each; the new key is strictly looser
-- than the old one, so every existing row satisfies it.

alter table rate_cards drop constraint if exists rate_cards_no_overlap;

alter table rate_cards
  add constraint rate_cards_no_overlap
  unique nulls not distinct (branch_id, direction, partner_id, customer_id, mode, origin_id,
                             destination_id, validity without overlaps);

-- ---------------------------------------------------------------------------
-- S3 — backfill `quotes.superseded_by_id`
-- ---------------------------------------------------------------------------
--
-- Nothing ever wrote it, and every "current quotation" read filters on it: an
-- enquiry priced seven times appeared seven times in the enquiry queue, and
-- withdrawn versions were offered as options on the comparison page. New
-- versions now set it (`retireQuoteVersion`); this points every older version
-- at the version that came straight after it, so existing enquiries read right
-- too. Status is left alone — the old rows already say `superseded` where a
-- revision retired them, and a rejected or expired one stays what it was.
--
-- Run as the system principal: `quotes` inherits the enquiry's policy, under
-- FORCE row-level security even for the owning role, so without it the update
-- sees no rows. The audit trigger records the system principal as the actor.

select set_config('app.principal_type', 'system', false),
       set_config('app.principal_id', '00000000-0000-7000-8000-000000000001', false);

update quotes q
   set superseded_by_id = n.id
  from quotes n
 where q.superseded_by_id is null
   and n.enquiry_id = q.enquiry_id
   and n.version = (
         select min(v.version)
           from quotes v
          where v.enquiry_id = q.enquiry_id
            and v.version > q.version
       );

select set_config('app.principal_type', '', false),
       set_config('app.principal_id', '', false);
