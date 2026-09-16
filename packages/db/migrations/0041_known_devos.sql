CREATE TYPE "public"."rate_request_status" AS ENUM('sent', 'responded', 'parsed', 'accepted', 'declined', 'expired', 'superseded');--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "status" "rate_request_status" DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "respond_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "quoted_currency" text;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "quoted_total" numeric(19, 6);--> statement-breakpoint
ALTER TABLE "rate_requests" ADD COLUMN "rate_card_id" uuid;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD CONSTRAINT "rate_requests_quoted_currency_currencies_code_fk" FOREIGN KEY ("quoted_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD CONSTRAINT "rate_requests_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD CONSTRAINT "rate_requests_token_unique" UNIQUE("token");