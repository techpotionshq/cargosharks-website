-- Pending DDL from the background-service fixes (PR #3 sweep, part 5, and
-- review threads R5/R7). Applied in order; each block says which item needs it.

-- R7: fx_rates.rate keeps the reciprocal of a weak currency's quote.
-- numeric(19,8) held about six significant figures of JPY->KWD (~0.00204082);
-- (24,14) keeps at least eleven. Widening a numeric loses nothing.
alter table fx_rates alter column rate type numeric(24, 14);
