-- A container count is a positive whole number, or not stated at all (F39).
--
-- `enquiries.container_count` (0047) is what a sea FCL quotation multiplies every
-- per-container rate by, so a zero or negative count would price a lane at
-- nothing or less than nothing. Null stays legal — it means the customer has not
-- said, and pricing refuses a FCL enquiry until someone enters it rather than
-- falling back to `pieces`, which counts packages. Same shape as
-- `job_cargo_packages_positive` in 0010.
--
-- No backfill, deliberately: nothing already stored says how many containers an
-- existing enquiry wanted, and inferring it from `pieces` is the bug being fixed.
alter table enquiries
  add constraint enquiries_container_count_positive
  check (container_count is null or container_count > 0);
