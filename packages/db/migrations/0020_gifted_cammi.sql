CREATE TABLE "credit_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"job_id" uuid,
	"invoice_id" uuid,
	"exposure" numeric(19, 6) NOT NULL,
	"credit_limit" numeric(19, 6) NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"approved_by_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pod_photos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"pod_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proof_of_delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"equipment_id" uuid,
	"delivered_at" timestamp with time zone NOT NULL,
	"received_by_name" text NOT NULL,
	"received_by_id_number" text,
	"signature_asset_id" uuid,
	"latitude" numeric(19, 6),
	"longitude" numeric(19, 6),
	"accuracy_metres" numeric(19, 6),
	"has_exception" boolean DEFAULT false NOT NULL,
	"exception_notes" text,
	"notes" text,
	"captured_by_id" uuid,
	"customer_visible" boolean DEFAULT true NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "free_time_clocks" ADD COLUMN "warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_approved_by_id_principals_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_photos" ADD CONSTRAINT "pod_photos_pod_id_proof_of_delivery_id_fk" FOREIGN KEY ("pod_id") REFERENCES "public"."proof_of_delivery"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_photos" ADD CONSTRAINT "pod_photos_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_of_delivery" ADD CONSTRAINT "proof_of_delivery_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_of_delivery" ADD CONSTRAINT "proof_of_delivery_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_of_delivery" ADD CONSTRAINT "proof_of_delivery_signature_asset_id_assets_id_fk" FOREIGN KEY ("signature_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_of_delivery" ADD CONSTRAINT "proof_of_delivery_captured_by_id_principals_id_fk" FOREIGN KEY ("captured_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_overrides_customer_idx" ON "credit_overrides" USING btree ("customer_id","branch_id","approved_at");--> statement-breakpoint
CREATE INDEX "credit_overrides_standing_idx" ON "credit_overrides" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "pod_photos_pod_idx" ON "pod_photos" USING btree ("pod_id","sort_order");--> statement-breakpoint
CREATE INDEX "proof_of_delivery_job_idx" ON "proof_of_delivery" USING btree ("job_id","delivered_at");--> statement-breakpoint
CREATE INDEX "proof_of_delivery_open_idx" ON "proof_of_delivery" USING btree ("superseded_by_id");--> statement-breakpoint
CREATE INDEX "free_time_clocks_unwarned_idx" ON "free_time_clocks" USING btree ("warned_at","ends_on");