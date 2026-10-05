-- R3 (live run 5): a newer agent rate could not replace an older card on the
-- same lane, so pricing went on quoting from the older one.
--
-- RTMAG's rate on Hamburg to Shuwaikh became a card on 05 Oct. A second
-- RTMAG reply the same day, now with a EUR 75 minimum, was refused "would
-- overlap" — `promoteRateReply` can end an earlier card where a new one
-- starts, but a card starting on the same day cannot be ended before it
-- began, and `valid_to > valid_from` rightly forbids an empty window. Price
-- it then costed the enquiry at KWD 165.501 from the old card while the same
-- page ranked the new reply at KWD 172.494.
--
-- The way out is the column the table always had: `superseded_by_id`
-- (FR-RT-08, "editing creates a new version and points the old one here").
-- Every read of live cover already skips a superseded card. What stopped it
-- being used is that `rate_cards_no_overlap` counted superseded rows too, so
-- a replacement for the same window could never be written. Nothing is
-- deleted: the old card keeps its window and its lines as history, and says
-- which card replaced it.
--
-- So the key becomes an exclusion constraint over the live cards only. It is
-- the same key as 0050's, column for column; `coalesce` to the nil uuid gives
-- the `nulls not distinct` reading 0050 had (a general card and a customer
-- card for one lane still coexist, because their customer ids differ). It
-- raises 23P01 exactly as before, so every caller that reads that code is
-- unchanged. btree_gist has been installed since 0002.
--
-- Not deferrable: ON CONFLICT refuses a deferrable constraint even as an
-- implicit arbiter, and inserts here use it. `promoteRateReply` orders its
-- writes instead (see the comment there).
--
-- Strictly looser than 0050's key, so every existing row satisfies it.

alter table rate_cards drop constraint if exists rate_cards_no_overlap;

alter table rate_cards
  add constraint rate_cards_no_overlap
  exclude using gist (
    branch_id with =,
    direction with =,
    coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    mode with =,
    coalesce(origin_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(destination_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    validity with &&
  )
  where (superseded_by_id is null);
