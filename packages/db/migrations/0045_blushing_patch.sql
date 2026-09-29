CREATE TABLE "whatsapp_numbers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_number" text,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_numbers_phone_number_id_unique" UNIQUE("phone_number_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_numbers_branch_idx" ON "whatsapp_numbers" USING btree ("branch_id","is_active");