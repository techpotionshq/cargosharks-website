CREATE TABLE "intake_conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"customer_address" text NOT NULL,
	"business_address" text NOT NULL,
	"locale" text,
	"state" text DEFAULT 'collecting' NOT NULL,
	"agent_enabled" boolean DEFAULT true NOT NULL,
	"agent_toggled_by_id" uuid,
	"agent_toggled_at" timestamp with time zone,
	"pending_since" timestamp with time zone,
	"turn_due_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"claim_token" uuid,
	"turns" integer DEFAULT 0 NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"clarifications" integer DEFAULT 0 NOT NULL,
	"last_clarified_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"handed_off_at" timestamp with time zone,
	"last_staff_activity_at" timestamp with time zone,
	"last_turn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_conversations_enquiry_unique" UNIQUE("enquiry_id"),
	CONSTRAINT "intake_conversations_state_check" CHECK ("intake_conversations"."state" in ('collecting', 'awaiting_customer', 'complete', 'handed_off')),
	CONSTRAINT "intake_conversations_channel_check" CHECK ("intake_conversations"."channel" in ('whatsapp', 'email'))
);
--> statement-breakpoint
CREATE TABLE "intake_requirements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid,
	"mode" "transport_mode",
	"key" text NOT NULL,
	"fields" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_requirements_fields_nonempty" CHECK (jsonb_array_length("intake_requirements"."fields") > 0)
);
--> statement-breakpoint
CREATE TABLE "intake_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"whatsapp_quiet_seconds" integer DEFAULT 120 NOT NULL,
	"whatsapp_max_wait_seconds" integer DEFAULT 600 NOT NULL,
	"email_quiet_seconds" integer DEFAULT 60 NOT NULL,
	"email_max_wait_seconds" integer DEFAULT 600 NOT NULL,
	"clarify_cooldown_hours" integer DEFAULT 6 NOT NULL,
	"clarify_cap" integer DEFAULT 2 NOT NULL,
	"human_takeover_hours" integer DEFAULT 12 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_settings_branch_unique" UNIQUE NULLS NOT DISTINCT("branch_id")
);
--> statement-breakpoint
CREATE TABLE "intake_turns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locale" text,
	"invocation_id" uuid,
	"reply_message_id" uuid,
	"send_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "container_type" text;--> statement-breakpoint
ALTER TABLE "intake_conversations" ADD CONSTRAINT "intake_conversations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_conversations" ADD CONSTRAINT "intake_conversations_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_conversations" ADD CONSTRAINT "intake_conversations_agent_toggled_by_id_principals_id_fk" FOREIGN KEY ("agent_toggled_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requirements" ADD CONSTRAINT "intake_requirements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_settings" ADD CONSTRAINT "intake_settings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_turns" ADD CONSTRAINT "intake_turns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_turns" ADD CONSTRAINT "intake_turns_conversation_id_intake_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."intake_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_turns" ADD CONSTRAINT "intake_turns_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_turns" ADD CONSTRAINT "intake_turns_invocation_id_ai_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."ai_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_turns" ADD CONSTRAINT "intake_turns_reply_message_id_messages_id_fk" FOREIGN KEY ("reply_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_conversations_due_idx" ON "intake_conversations" USING btree ("turn_due_at");--> statement-breakpoint
CREATE INDEX "intake_conversations_customer_idx" ON "intake_conversations" USING btree ("branch_id","customer_address");--> statement-breakpoint
CREATE INDEX "intake_requirements_branch_idx" ON "intake_requirements" USING btree ("branch_id","is_active");--> statement-breakpoint
CREATE INDEX "intake_turns_conversation_idx" ON "intake_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_container_type_container_types_code_fk" FOREIGN KEY ("container_type") REFERENCES "public"."container_types"("code") ON DELETE no action ON UPDATE no action;