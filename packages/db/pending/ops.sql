-- Operations fixes (O13, O14) — pending SQL, to become a custom migration.
--
-- Applied as app_migrator. Each statement says why it exists.

-- --------------------------------------------------------------------------
-- O14: a house bill number names one shipment within the branch that issued it.
--
-- The house bill is the number we issue, and the bank, the consignee and the
-- delivery order all read it as identifying one consignment. Nothing stopped
-- two jobs carrying the same one, and `saveJob` reported every unique
-- violation as "that master bill number is taken" — a constraint that does not
-- exist, and should not: houses consolidated under one master share it.
--
-- Per branch, because each legal entity numbers its own bills. Partial, because
-- most jobs have no house bill until it is issued.
create unique index if not exists jobs_house_bill_unique
  on jobs (branch_id, house_bill_number)
  where house_bill_number is not null;

-- --------------------------------------------------------------------------
-- O12: an unsplit consolidation cost can be withdrawn.
--
-- A master cost entered against the wrong consolidation, or twice, could be
-- neither edited nor removed. Nothing is deleted (§5.5), so it is stamped; the
-- page and the allocation read only rows where this is null, and the action
-- refuses to withdraw a cost whose split is standing.
alter table consol_charge_lines add column if not exists withdrawn_at timestamptz;

-- --------------------------------------------------------------------------
-- O13: one document row per (job, type, language, version).
--
-- The version was read in one transaction and written in another, so two
-- issues at once both recorded the same version against one storage key.
-- `storeJobDocument` now takes an advisory lock and versions per language;
-- this is the backstop that refuses a duplicate rather than recording it.
-- No existing row violates it: versions were unique per job and type, which
-- is stricter than per language.
create unique index if not exists documents_version_unique
  on documents (job_id, document_type_id, locale, version);
