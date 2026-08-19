-- Payables, cost verification and the agent current account — the tables.
--
-- Generated from the TypeScript schema (`pnpm db:generate`). The policies,
-- triggers, checks and grants that make these tables usable are hand-written
-- in 0018, per the walkthrough in CONTRIBUTING.md: RLS enabled without a
-- policy denies every row to everyone, silently.
--
-- ## What this adds, and why
--
-- `invoices.customer_id` is `not null` and always was: that table is
-- receivables and nothing else. Costs existed as `charge_lines` carrying a
-- `counterparty_partner_id`, which gives job P&L and gives 0011's export a
-- payable to credit — but there was nothing to match a carrier's actual bill
-- against what the job accrued. That is the gap this closes, and it is the
-- most expensive one in the product: the commonest argument in a forwarder's
-- week is the line or the agent billing something other than what they quoted,
-- and without this it is found in a spreadsheet after the customer has already
-- been invoiced at the accrued figure.
--
--   supplier_invoices          what they asked for, as they wrote it
--   supplier_invoice_lines     their lines, in their vocabulary
--   supplier_invoice_matches   their lines against our accruals, many-to-many
--   supplier_payments          money out, and its allocation
--   partner_settlements        a month's set-off with an agent, as a document
--
-- Matching is many-to-many because both directions genuinely happen: one
-- master freight accrual billed across two invoices, and one invoice line
-- covering three jobs' worth of accrual. A foreign key in either direction
-- would model a shape the business does not have.
--
-- The columns added to `charge_types` and `partners` are the tolerance
-- configuration `core/matching.ts` reads, and they are rows rather than code
-- because FR-AD-03 says an administrator changes them without a release.

CREATE TYPE "public"."settlement_direction" AS ENUM('they_owe_us', 'we_owe_them', 'square');--> statement-breakpoint
CREATE TYPE "public"."settlement_line_kind" AS ENUM('invoice', 'bill');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('draft', 'agreed', 'settled', 'void');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_status" AS ENUM('received', 'approved', 'part_paid', 'paid', 'disputed', 'void');--> statement-breakpoint
CREATE TABLE "partner_settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" "settlement_line_kind" NOT NULL,
	"invoice_id" uuid,
	"supplier_invoice_id" uuid,
	"amount" numeric(19, 6) NOT NULL,
	"is_full" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_settlement_lines_invoice_unique" UNIQUE("settlement_id","invoice_id"),
	CONSTRAINT "partner_settlement_lines_bill_unique" UNIQUE("settlement_id","supplier_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "partner_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" "settlement_status" DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"receivable_total" numeric(19, 6) DEFAULT '0' NOT NULL,
	"payable_total" numeric(19, 6) DEFAULT '0' NOT NULL,
	"offset_amount" numeric(19, 6) DEFAULT '0' NOT NULL,
	"residual_amount" numeric(19, 6) DEFAULT '0' NOT NULL,
	"residual_direction" "settlement_direction" DEFAULT 'square' NOT NULL,
	"fx_rate" numeric(19, 8) DEFAULT '1' NOT NULL,
	"fx_rate_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agreed_at" timestamp with time zone,
	"agreed_by_id" uuid,
	"settled_at" timestamp with time zone,
	"settled_by_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"statement_asset_id" uuid,
	"accounting_export_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_settlements_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"job_id" uuid,
	"charge_type_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(19, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(19, 6) NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"tax_amount" numeric(19, 6) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_matches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supplier_invoice_line_id" uuid NOT NULL,
	"charge_line_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"matched_by_id" uuid,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retracted_at" timestamp with time zone,
	"retracted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoice_matches_unique" UNIQUE("supplier_invoice_line_id","charge_line_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "supplier_invoice_status" DEFAULT 'received' NOT NULL,
	"currency" text NOT NULL,
	"subtotal" numeric(19, 6) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(19, 6) DEFAULT '0' NOT NULL,
	"total" numeric(19, 6) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(19, 6) DEFAULT '0' NOT NULL,
	"fx_rate" numeric(19, 8) DEFAULT '1' NOT NULL,
	"fx_rate_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_date" date NOT NULL,
	"due_on" date,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"asset_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"variance_accepted_at" timestamp with time zone,
	"variance_accepted_reason" text,
	"disputed_at" timestamp with time zone,
	"dispute_reason" text,
	"settlement_id" uuid,
	"accounting_export_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_reference_unique" UNIQUE("partner_id","reference")
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supplier_payment_id" uuid NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payment_allocations_unique" UNIQUE("supplier_payment_id","supplier_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(19, 8) DEFAULT '1' NOT NULL,
	"fx_rate_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"recorded_by_id" uuid,
	"accounting_export_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "input_tax_account_code" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "margin_floor_percent" numeric(19, 6);--> statement-breakpoint
ALTER TABLE "charge_types" ADD COLUMN "variance_tolerance_percent" numeric(19, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_types" ADD COLUMN "variance_tolerance_absolute" numeric(19, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "variance_tolerance_percent" numeric(19, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "variance_tolerance_absolute" numeric(19, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "settlement_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "settlement_currency" text;--> statement-breakpoint
ALTER TABLE "partner_settlement_lines" ADD CONSTRAINT "partner_settlement_lines_settlement_id_partner_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."partner_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlement_lines" ADD CONSTRAINT "partner_settlement_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlement_lines" ADD CONSTRAINT "partner_settlement_lines_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_agreed_by_id_principals_id_fk" FOREIGN KEY ("agreed_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_settled_by_id_principals_id_fk" FOREIGN KEY ("settled_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_statement_asset_id_assets_id_fk" FOREIGN KEY ("statement_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_matches" ADD CONSTRAINT "supplier_invoice_matches_supplier_invoice_line_id_supplier_invoice_lines_id_fk" FOREIGN KEY ("supplier_invoice_line_id") REFERENCES "public"."supplier_invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_matches" ADD CONSTRAINT "supplier_invoice_matches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_matches" ADD CONSTRAINT "supplier_invoice_matches_matched_by_id_principals_id_fk" FOREIGN KEY ("matched_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_matches" ADD CONSTRAINT "supplier_invoice_matches_retracted_by_id_principals_id_fk" FOREIGN KEY ("retracted_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_approved_by_id_principals_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplier_payment_id_supplier_payments_id_fk" FOREIGN KEY ("supplier_payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_recorded_by_id_principals_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_settlement_lines_settlement_idx" ON "partner_settlement_lines" USING btree ("settlement_id","kind");--> statement-breakpoint
CREATE INDEX "partner_settlements_partner_idx" ON "partner_settlements" USING btree ("partner_id","status","period_to");--> statement-breakpoint
CREATE INDEX "partner_settlements_unposted_idx" ON "partner_settlements" USING btree ("branch_id","accounting_export_id");--> statement-breakpoint
CREATE INDEX "supplier_invoice_lines_invoice_idx" ON "supplier_invoice_lines" USING btree ("supplier_invoice_id","sort_order");--> statement-breakpoint
CREATE INDEX "supplier_invoice_lines_job_idx" ON "supplier_invoice_lines" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "supplier_invoice_matches_charge_idx" ON "supplier_invoice_matches" USING btree ("charge_line_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_partner_idx" ON "supplier_invoices" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "supplier_invoices_ageing_idx" ON "supplier_invoices" USING btree ("branch_id","status","due_on");--> statement-breakpoint
CREATE INDEX "supplier_invoices_unposted_idx" ON "supplier_invoices" USING btree ("branch_id","accounting_export_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_partner_idx" ON "supplier_payments" USING btree ("partner_id","paid_on");--> statement-breakpoint
CREATE INDEX "supplier_payments_export_idx" ON "supplier_payments" USING btree ("accounting_export_id");--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_settlement_customer_id_customers_id_fk" FOREIGN KEY ("settlement_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_settlement_currency_currencies_code_fk" FOREIGN KEY ("settlement_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partners_settlement_idx" ON "partners" USING btree ("settlement_customer_id");