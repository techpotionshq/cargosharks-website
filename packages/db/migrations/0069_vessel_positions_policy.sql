-- Vessel positions: who may read a ship's last fix, and who may write it.
--
-- `vessel_positions` is declared with `systemTable`, which exempts it from the
-- audit trigger and from nothing else. The reason is in the schema file: the
-- row is rewritten every few minutes per vessel from a third party's
-- broadcast, and auditing it would add an `audit_log` row per AIS report to
-- record that a ship moved. The audited fact is which vessel a job sails on,
-- `jobs.vessel_mmsi`, and `jobs` is audited already.
--
-- Row-level security is not exempted. Enabled and forced, like every table.

alter table vessel_positions enable row level security;
alter table vessel_positions force  row level security;

-- Read: a vessel is visible exactly when a job sailing on it is.
--
-- The subquery runs under the reader's own role, so `jobs_scope` applies
-- inside it: staff see the vessels on their branches' jobs, a customer contact
-- the vessels carrying their company's cargo, and an agent the vessels on jobs
-- their partner is named on. Nothing here restates those rules, which is the
-- point: a change to who sees a job is a change to who sees its ship.
--
-- `jobs_scope` reads `job_partners`, never this table, so the two policies
-- cannot recurse.
create policy vessel_positions_read on vessel_positions for select using (
  app.is_system()
  or exists (select 1 from jobs j where j.vessel_mmsi = vessel_positions.mmsi)
);

-- Write: the service's system actor only. No person types a position; a
-- person edits the job's MMSI, and the position follows from the feed.
create policy vessel_positions_write on vessel_positions for insert
  with check (app.is_system());
create policy vessel_positions_update on vessel_positions for update
  using (app.is_system()) with check (app.is_system());

-- The identifiers on the job, checked at the boundary as well as in the form.
--
-- An MMSI that is not nine digits starting 2 to 7 is not a ship station and
-- can only subscribe to nothing, or to the wrong thing. The IMO check digit is
-- verified in core (`normaliseImo`); the shape is enough here.
alter table jobs add constraint jobs_vessel_mmsi_shape
  check (vessel_mmsi is null or vessel_mmsi ~ '^[2-7][0-9]{8}$');
alter table jobs add constraint jobs_vessel_imo_shape
  check (vessel_imo is null or vessel_imo ~ '^[0-9]{7}$');
