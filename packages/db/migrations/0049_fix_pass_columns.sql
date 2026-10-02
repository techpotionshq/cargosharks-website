ALTER TABLE "fx_rates" ALTER COLUMN "rate" SET DATA TYPE numeric(24, 14);--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "send_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "last_send_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "send_error" text;--> statement-breakpoint
ALTER TABLE "consol_charge_lines" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fx_rate" numeric(19, 8);--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "uid_cursor" jsonb;--> statement-breakpoint
CREATE INDEX "rate_requests_unsent_idx" ON "rate_requests" USING btree ("status","sent_at","last_send_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_version_unique" ON "documents" USING btree ("job_id","document_type_id","locale","version");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_house_bill_unique" ON "jobs" USING btree ("branch_id","house_bill_number") WHERE "jobs"."house_bill_number" is not null;