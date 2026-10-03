-- fix4-money: pending DDL, for the coordinator to fold into one migration.

-- N1: LCL rates are quoted per cubic metre or per W/M (the revenue ton, the
-- greater of cbm and tonnes), and the basis enum had neither, so a per-cbm rate
-- was stored as per_unit and multiplied by the package count. Matches the order
-- in packages/db/src/schema/enums.ts. ADD VALUE commits on its own; nothing in
-- this file uses the new values, so it is safe inside the migration's transaction.
alter type public.charge_basis add value if not exists 'per_cbm' after 'per_kg';
alter type public.charge_basis add value if not exists 'per_wm' after 'per_cbm';
