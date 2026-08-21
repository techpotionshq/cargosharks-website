CREATE TYPE "public"."ai_surface" AS ENUM('enquiry_extract', 'document_classify', 'document_extract', 'invoice_extract', 'rate_mapping', 'rate_extract', 'assistant', 'draft_reply');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('proposed', 'accepted', 'rejected', 'applied', 'superseded', 'refused');--> statement-breakpoint
CREATE TABLE "ai_invocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"surface" "ai_surface" NOT NULL,
	"principal_id" uuid NOT NULL,
	"model_requested" text NOT NULL,
	"model_served" text,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(19, 6),
	"latency_ms" integer,
	"finish_reason" text,
	"error" text,
	"enquiry_id" uuid,
	"job_id" uuid,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"target_table" text NOT NULL,
	"target_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"confidence" numeric(5, 4),
	"evidence" text,
	"status" "proposal_status" DEFAULT 'proposed' NOT NULL,
	"target_was_empty" boolean DEFAULT true NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_proposals" ADD CONSTRAINT "extraction_proposals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_proposals" ADD CONSTRAINT "extraction_proposals_invocation_id_ai_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."ai_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_proposals" ADD CONSTRAINT "extraction_proposals_decided_by_id_principals_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_invocations_cost_idx" ON "ai_invocations" USING btree ("branch_id","surface","created_at");--> statement-breakpoint
CREATE INDEX "ai_invocations_hash_idx" ON "ai_invocations" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "ai_invocations_enquiry_idx" ON "ai_invocations" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "ai_invocations_job_idx" ON "ai_invocations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "extraction_proposals_queue_idx" ON "extraction_proposals" USING btree ("branch_id","status","created_at");--> statement-breakpoint
CREATE INDEX "extraction_proposals_target_idx" ON "extraction_proposals" USING btree ("target_table","target_id","status");--> statement-breakpoint
CREATE INDEX "extraction_proposals_invocation_idx" ON "extraction_proposals" USING btree ("invocation_id");