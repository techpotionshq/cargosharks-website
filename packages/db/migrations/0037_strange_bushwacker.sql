ALTER TABLE "auth_user" ADD COLUMN "failed_sign_in_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "last_failed_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "locked_until" timestamp with time zone;