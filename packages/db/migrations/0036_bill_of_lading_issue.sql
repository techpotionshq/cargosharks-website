ALTER TABLE "branches" ADD COLUMN "bill_of_lading_terms_en" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "bill_of_lading_terms_ar" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "place_of_receipt" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "place_of_delivery" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "house_bill_surrendered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "house_bill_surrendered_by_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_house_bill_surrendered_by_id_principals_id_fk" FOREIGN KEY ("house_bill_surrendered_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;