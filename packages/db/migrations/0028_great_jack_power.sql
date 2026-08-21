CREATE TABLE "integration_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"driver" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "mail_from" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "quiet_hours_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "quiet_hours_from_hour" integer DEFAULT 21 NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "quiet_hours_to_hour" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "is_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "poll_batch" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "max_attachment_mb" integer DEFAULT 25 NOT NULL;