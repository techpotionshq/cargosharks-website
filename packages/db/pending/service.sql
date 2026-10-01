-- Pending DDL from the background-service fixes (PR #3 sweep, part 5, and
-- review threads R5/R7). Applied in order; each block says which item needs it.

-- R7: fx_rates.rate keeps the reciprocal of a weak currency's quote.
-- numeric(19,8) held about six significant figures of JPY->KWD (~0.00204082);
-- (24,14) keeps at least eleven. Widening a numeric loses nothing.
alter table fx_rates alter column rate type numeric(24, 14);

-- V10: the RFQ send drain retried every unsendable row every minute, forever,
-- with `limit 200` and no order. Attempts and the last try drive a backoff and
-- a ceiling; send_error says why a request never went out.
alter table rate_requests add column send_attempts integer not null default 0;
alter table rate_requests add column last_send_attempt_at timestamp with time zone;
alter table rate_requests add column send_error text;
create index rate_requests_unsent_idx on rate_requests (status, sent_at, last_send_attempt_at);
