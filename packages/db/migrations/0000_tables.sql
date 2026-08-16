CREATE TYPE "public"."charge_basis" AS ENUM('flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('email', 'whatsapp', 'in_app', 'portal');--> statement-breakpoint
CREATE TYPE "public"."charge_direction" AS ENUM('cost', 'revenue');--> statement-breakpoint
CREATE TYPE "public"."clock_kind" AS ENUM('demurrage', 'detention', 'storage');--> statement-breakpoint
CREATE TYPE "public"."customs_status" AS ENUM('not_started', 'documents_pending', 'declaration_filed', 'assessed', 'duty_paid', 'inspection', 'released', 'held');--> statement-breakpoint
CREATE TYPE "public"."day_basis" AS ENUM('calendar', 'working');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."trade_direction" AS ENUM('import', 'export', 'cross_trade');--> statement-breakpoint
CREATE TYPE "public"."enquiry_status" AS ENUM('new', 'assigned', 'rating', 'quoted', 'won', 'lost', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'approved', 'issued', 'part_paid', 'paid', 'credited', 'void');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('draft', 'booked', 'in_transit', 'arrived', 'customs', 'delivered', 'completed', 'closed', 'on_hold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('en', 'ar');--> statement-breakpoint
CREATE TYPE "public"."margin_kind" AS ENUM('percent', 'absolute', 'target_sell');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."transport_mode" AS ENUM('sea_fcl', 'sea_lcl', 'air', 'land', 'courier');--> statement-breakpoint
CREATE TYPE "public"."partner_type" AS ENUM('agent', 'haulier', 'carrier', 'broker', 'terminal');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('internal', 'customer_contact', 'agent_contact', 'system');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."rate_direction" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."exception_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."tax_treatment" AS ENUM('out_of_scope', 'zero_rated', 'exempt', 'standard', 'reverse_charge');--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"checksum" text,
	"uploaded_by_id" uuid,
	"meta" jsonb,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"name" text NOT NULL,
	"customer_id" uuid,
	"branch_id" uuid,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"legal_name_en" text NOT NULL,
	"legal_name_ar" text NOT NULL,
	"country" text NOT NULL,
	"base_currency" text NOT NULL,
	"tax_registration" text,
	"invoice_series" text NOT NULL,
	"invoice_series_next" integer DEFAULT 1 NOT NULL,
	"letterhead_asset_id" uuid,
	"calendar_id" uuid NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kuwait' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "principal_branch_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"principal_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principal_branch_role_unique" UNIQUE("principal_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" "principal_type" NOT NULL,
	"auth_user_id" text,
	"email" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"phone" text,
	"customer_id" uuid,
	"partner_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_unique" UNIQUE("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"requires_two_factor" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "calendar_holidays" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_holidays_unique" UNIQUE("calendar_id","on_date")
);
--> statement-breakpoint
CREATE TABLE "charge_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"default_basis" charge_basis NOT NULL,
	"default_currency" text,
	"category" text NOT NULL,
	"is_customer_visible" boolean DEFAULT true NOT NULL,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "chargeable_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mode" "transport_mode" NOT NULL,
	"divisor_cm3_per_kg" numeric(19, 6),
	"round_up_to_kg" numeric(19, 6) NOT NULL,
	"minimum_kg" numeric(19, 6) DEFAULT '0' NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chargeable_rules_unique" UNIQUE("mode","branch_id")
);
--> statement-breakpoint
CREATE TABLE "commodities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"hs_code" text,
	"is_dangerous" boolean DEFAULT false NOT NULL,
	"requires_temperature_control" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commodities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "container_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"teu" numeric(19, 6) NOT NULL,
	"is_reefer" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"default_currency" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"minor_units" integer NOT NULL,
	"symbol" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"category" text NOT NULL,
	"is_customer_visible" boolean DEFAULT true NOT NULL,
	"is_required_for_clearance" boolean DEFAULT false NOT NULL,
	"expiry_warning_days" jsonb DEFAULT '[60,30,7]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "exception_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"default_severity" "exception_severity" DEFAULT 'medium' NOT NULL,
	"default_owner_role" text,
	"customer_visible_by_default" boolean DEFAULT false NOT NULL,
	"sla_hours" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exception_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "free_time_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "clock_kind" NOT NULL,
	"branch_id" uuid,
	"mode" "transport_mode",
	"container_type" text,
	"partner_id" uuid,
	"free_days" integer NOT NULL,
	"per_diem" numeric(19, 6) NOT NULL,
	"currency" text NOT NULL,
	"day_basis" "day_basis" DEFAULT 'calendar' NOT NULL,
	"tiers" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" numeric(19, 8) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"effective_on" date NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_unique" UNIQUE("from_currency","to_currency","effective_on","source")
);
--> statement-breakpoint
CREATE TABLE "incoterms" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"year" integer DEFAULT 2020 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"unlocode" text,
	"name_en" text NOT NULL,
	"name_ar" text,
	"country_code" text NOT NULL,
	"kind" text NOT NULL,
	"latitude" numeric(19, 6),
	"longitude" numeric(19, 6),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mode" "transport_mode" NOT NULL,
	"direction" "trade_direction" NOT NULL,
	"service_type" text,
	"seq" integer NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"owner_role" text,
	"customer_visible" boolean DEFAULT true NOT NULL,
	"planned_offset_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_templates_unique" UNIQUE("mode","direction","service_type","code")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_key" text NOT NULL,
	"channel" "message_channel" NOT NULL,
	"locale" "locale" NOT NULL,
	"branch_id" uuid,
	"subject" text,
	"body" text NOT NULL,
	"provider_template_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_unique" UNIQUE("event_key","channel","locale","branch_id")
);
--> statement-breakpoint
CREATE TABLE "working_calendars" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"time_zone" text NOT NULL,
	"weekend" jsonb DEFAULT '[5,6]'::jsonb NOT NULL,
	"day_start_minute" integer DEFAULT 480 NOT NULL,
	"day_end_minute" integer DEFAULT 1020 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_calendars_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "customer_branch_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"credit_limit" numeric(19, 6),
	"credit_currency" text,
	"free_time_days" integer,
	"default_incoterm" text,
	"default_margin_kind" "margin_kind",
	"default_margin_value" numeric(19, 6),
	"is_on_hold" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_branch_terms_unique" UNIQUE("customer_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"principal_id" uuid,
	"name_en" text NOT NULL,
	"name_ar" text,
	"email" text,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notification_opt_outs" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"legal_name_en" text NOT NULL,
	"legal_name_ar" text,
	"registration" text,
	"tax_registration" text,
	"country_code" text,
	"primary_branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "partner_compliance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"asset_id" uuid,
	"reference" text,
	"issued_on" date,
	"expires_on" date,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"principal_id" uuid,
	"name_en" text NOT NULL,
	"name_ar" text,
	"email" text,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_coverage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"mode" "transport_mode" NOT NULL,
	"origin_id" uuid,
	"destination_id" uuid,
	"origin_country" text,
	"destination_country" text,
	"transit_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"type" "partner_type" NOT NULL,
	"legal_name_en" text NOT NULL,
	"legal_name_ar" text,
	"country_code" text,
	"currency" text,
	"payment_terms_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rate_card_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"charge_type_id" uuid NOT NULL,
	"basis" charge_basis NOT NULL,
	"rate" numeric(19, 6) NOT NULL,
	"currency" text NOT NULL,
	"minimum" numeric(19, 6),
	"maximum" numeric(19, 6),
	"container_type" text,
	"weight_breaks" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"direction" "rate_direction" NOT NULL,
	"partner_id" uuid,
	"customer_id" uuid,
	"branch_id" uuid NOT NULL,
	"mode" "transport_mode" NOT NULL,
	"trade_direction" "trade_direction",
	"origin_id" uuid,
	"destination_id" uuid,
	"validity" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"currency" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"superseded_by_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"enquiry_id" uuid,
	"partner_id" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"response" jsonb,
	"declined_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customs_stages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "customs_status" DEFAULT 'not_started' NOT NULL,
	"declaration_type" text,
	"declaration_no" text,
	"filed_at" timestamp with time zone,
	"duty_amount" numeric(19, 6),
	"duty_currency" text,
	"inspection_required" boolean DEFAULT false NOT NULL,
	"inspection_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"broker_partner_id" uuid,
	"sla_due_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"superseded_by_id" uuid,
	"released_at" timestamp with time zone,
	"released_by_id" uuid,
	"author_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid,
	"contact_email" text,
	"contact_name" text,
	"owner_id" uuid,
	"status" "enquiry_status" DEFAULT 'new' NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"mode" "transport_mode",
	"trade_direction" "trade_direction",
	"origin_id" uuid,
	"destination_id" uuid,
	"commodity_id" uuid,
	"incoterm" text,
	"ready_on" date,
	"gross_weight_kg" numeric(19, 6),
	"volume_cbm" numeric(19, 6),
	"pieces" integer,
	"dimensions" jsonb,
	"is_dangerous" boolean DEFAULT false NOT NULL,
	"notes" text,
	"sla_started_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"container_no" text,
	"container_type" text,
	"seal_no" text,
	"tare_weight_kg" numeric(19, 6),
	"gross_weight_kg" numeric(19, 6),
	"discharged_at" timestamp with time zone,
	"gate_out_at" timestamp with time zone,
	"gate_in_at" timestamp with time zone,
	"empty_returned_at" timestamp with time zone,
	"temperature_c" numeric(19, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"exception_code_id" uuid NOT NULL,
	"severity" "exception_severity" DEFAULT 'medium' NOT NULL,
	"owner_id" uuid,
	"description" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolution" text,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"cost_impact" numeric(19, 6),
	"cost_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "free_time_clocks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"equipment_id" uuid,
	"kind" "clock_kind" NOT NULL,
	"free_days" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"per_diem" numeric(19, 6) NOT NULL,
	"currency" text NOT NULL,
	"day_basis" "day_basis" DEFAULT 'calendar' NOT NULL,
	"tiers" jsonb,
	"counterparty_id" uuid,
	"accrued_days" integer DEFAULT 0 NOT NULL,
	"accrued_amount" numeric(19, 6),
	"last_accrued_at" timestamp with time zone,
	"charge_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_milestones" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"seq" integer NOT NULL,
	"planned_at" timestamp with time zone,
	"revised_at" timestamp with time zone,
	"actual_at" timestamp with time zone,
	"owner_role" text,
	"customer_visible" boolean DEFAULT true NOT NULL,
	"completed_by_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_milestones_unique" UNIQUE("job_id","code")
);
--> statement-breakpoint
CREATE TABLE "job_partners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"role" text NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_partners_unique" UNIQUE("job_id","partner_id","role")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"quote_id" uuid,
	"status" "job_status" DEFAULT 'draft' NOT NULL,
	"mode" "transport_mode" NOT NULL,
	"trade_direction" "trade_direction" NOT NULL,
	"owner_id" uuid,
	"origin_id" uuid,
	"destination_id" uuid,
	"commodity_id" uuid,
	"incoterm" text,
	"master_bill_number" text,
	"house_bill_number" text,
	"booking_number" text,
	"vessel_name" text,
	"voyage_number" text,
	"flight_number" text,
	"etd" timestamp with time zone,
	"eta" timestamp with time zone,
	"atd" timestamp with time zone,
	"ata" timestamp with time zone,
	"gross_weight_kg" numeric(19, 6),
	"chargeable_weight_kg" numeric(19, 6),
	"volume_cbm" numeric(19, 6),
	"pieces" integer,
	"customer_reference" text,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote_id" uuid NOT NULL,
	"charge_type_id" uuid NOT NULL,
	"description" text,
	"basis" text NOT NULL,
	"quantity" numeric(19, 6) DEFAULT '1' NOT NULL,
	"rate" numeric(19, 6) NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"currency" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"total_sell" numeric(19, 6),
	"total_cost" numeric(19, 6),
	"valid_until" date,
	"priced_snapshot" jsonb,
	"rate_card_version_id" uuid,
	"superseded_by_id" uuid,
	"prepared_by_id" uuid,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_reference_unique" UNIQUE("reference"),
	CONSTRAINT "quotes_version_unique" UNIQUE("enquiry_id","version")
);
--> statement-breakpoint
CREATE TABLE "accounting_exports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"format" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"asset_id" uuid,
	"row_count" integer DEFAULT 0 NOT NULL,
	"included_invoice_ids" jsonb DEFAULT '[]'::jsonb,
	"exported_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"direction" charge_direction NOT NULL,
	"charge_type_id" uuid NOT NULL,
	"description" text,
	"basis" charge_basis NOT NULL,
	"quantity" numeric(19, 6) DEFAULT '1' NOT NULL,
	"rate" numeric(19, 6) NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(19, 8) DEFAULT '1' NOT NULL,
	"fx_rate_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_base" numeric(19, 6) NOT NULL,
	"base_currency" text NOT NULL,
	"counterparty_partner_id" uuid,
	"counterparty_customer_id" uuid,
	"invoice_id" uuid,
	"source_kind" text,
	"source_id" uuid,
	"is_accrual" boolean DEFAULT false NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"charge_type_id" uuid,
	"description_en" text NOT NULL,
	"description_ar" text,
	"quantity" numeric(19, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(19, 6) NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"tax_amount" numeric(19, 6) DEFAULT '0' NOT NULL,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"series_no" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"subtotal" numeric(19, 6) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(19, 6) DEFAULT '0' NOT NULL,
	"total" numeric(19, 6) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(19, 6) DEFAULT '0' NOT NULL,
	"tax_treatment" "tax_treatment" DEFAULT 'out_of_scope' NOT NULL,
	"tax_rate_percent" numeric(19, 6) DEFAULT '0' NOT NULL,
	"language" "locale" DEFAULT 'en' NOT NULL,
	"issued_at" timestamp with time zone,
	"due_on" date,
	"credits_invoice_id" uuid,
	"is_credit_note" boolean DEFAULT false NOT NULL,
	"pdf_asset_id" uuid,
	"issued_by_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_series_unique" UNIQUE("branch_id","series_no")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_unique" UNIQUE("payment_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(19, 8) DEFAULT '1' NOT NULL,
	"fx_rate_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"recorded_by_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_webhook_events_unique" UNIQUE("provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"message_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"job_id" uuid,
	"enquiry_id" uuid,
	"channel" "message_channel" NOT NULL,
	"direction" "message_direction" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"from_address" text,
	"to_addresses" jsonb DEFAULT '[]'::jsonb,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb,
	"author_id" uuid,
	"external_ref" text,
	"customer_visible" boolean DEFAULT true NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"principal_id" uuid,
	"channel" "message_channel" NOT NULL,
	"locale" "locale" NOT NULL,
	"to_address" text NOT NULL,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"template_id" uuid,
	"external_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"deferred_until" timestamp with time zone,
	"suppressed_reason" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"job_id" uuid,
	"enquiry_id" uuid,
	"customer_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enqueued_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"response_status" integer,
	"response_body" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid,
	"branch_id" uuid,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"principal_id" uuid,
	"principal_type" text,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"op" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"branch_id" uuid,
	"ip" "inet"
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_principals_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revoked_by_id_principals_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_letterhead_asset_id_assets_id_fk" FOREIGN KEY ("letterhead_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_branch_roles" ADD CONSTRAINT "principal_branch_roles_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_branch_roles" ADD CONSTRAINT "principal_branch_roles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_branch_roles" ADD CONSTRAINT "principal_branch_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_calendar_id_working_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."working_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_default_currency_currencies_code_fk" FOREIGN KEY ("default_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargeable_rules" ADD CONSTRAINT "chargeable_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_time_rules" ADD CONSTRAINT "free_time_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_time_rules" ADD CONSTRAINT "free_time_rules_container_type_container_types_code_fk" FOREIGN KEY ("container_type") REFERENCES "public"."container_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_time_rules" ADD CONSTRAINT "free_time_rules_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_from_currency_currencies_code_fk" FOREIGN KEY ("from_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_to_currency_currencies_code_fk" FOREIGN KEY ("to_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_branch_terms" ADD CONSTRAINT "customer_branch_terms_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_branch_terms" ADD CONSTRAINT "customer_branch_terms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_branch_terms" ADD CONSTRAINT "customer_branch_terms_credit_currency_currencies_code_fk" FOREIGN KEY ("credit_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_primary_branch_id_branches_id_fk" FOREIGN KEY ("primary_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_compliance" ADD CONSTRAINT "partner_compliance_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_compliance" ADD CONSTRAINT "partner_compliance_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_compliance" ADD CONSTRAINT "partner_compliance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_contacts" ADD CONSTRAINT "partner_contacts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_contacts" ADD CONSTRAINT "partner_contacts_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_coverage" ADD CONSTRAINT "partner_coverage_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_coverage" ADD CONSTRAINT "partner_coverage_origin_id_locations_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_coverage" ADD CONSTRAINT "partner_coverage_destination_id_locations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_lines" ADD CONSTRAINT "rate_card_lines_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_lines" ADD CONSTRAINT "rate_card_lines_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_lines" ADD CONSTRAINT "rate_card_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_origin_id_locations_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_destination_id_locations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_created_by_id_principals_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD CONSTRAINT "rate_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_requests" ADD CONSTRAINT "rate_requests_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_stages" ADD CONSTRAINT "customs_stages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_stages" ADD CONSTRAINT "customs_stages_duty_currency_currencies_code_fk" FOREIGN KEY ("duty_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_stages" ADD CONSTRAINT "customs_stages_broker_partner_id_partners_id_fk" FOREIGN KEY ("broker_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_released_by_id_principals_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_principals_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_origin_id_locations_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_destination_id_locations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_container_type_container_types_code_fk" FOREIGN KEY ("container_type") REFERENCES "public"."container_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_exception_code_id_exception_codes_id_fk" FOREIGN KEY ("exception_code_id") REFERENCES "public"."exception_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_cost_currency_currencies_code_fk" FOREIGN KEY ("cost_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_time_clocks" ADD CONSTRAINT "free_time_clocks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_time_clocks" ADD CONSTRAINT "free_time_clocks_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_time_clocks" ADD CONSTRAINT "free_time_clocks_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_time_clocks" ADD CONSTRAINT "free_time_clocks_counterparty_id_partners_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_milestones" ADD CONSTRAINT "job_milestones_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_milestones" ADD CONSTRAINT "job_milestones_completed_by_id_principals_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_partners" ADD CONSTRAINT "job_partners_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_partners" ADD CONSTRAINT "job_partners_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_partners" ADD CONSTRAINT "job_partners_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_origin_id_locations_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_destination_id_locations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rate_card_version_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_version_id") REFERENCES "public"."rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_prepared_by_id_principals_id_fk" FOREIGN KEY ("prepared_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_exported_by_id_principals_id_fk" FOREIGN KEY ("exported_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_base_currency_currencies_code_fk" FOREIGN KEY ("base_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_counterparty_partner_id_partners_id_fk" FOREIGN KEY ("counterparty_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_counterparty_customer_id_customers_id_fk" FOREIGN KEY ("counterparty_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_approved_by_id_principals_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_id_principals_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_principals_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_principals_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_branch_idx" ON "assets" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "api_keys_customer_idx" ON "api_keys" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "branches_active_idx" ON "branches" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "principal_branch_roles_branch_idx" ON "principal_branch_roles" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principals_email_idx" ON "principals" USING btree ("email");--> statement-breakpoint
CREATE INDEX "principals_customer_idx" ON "principals" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "principals_partner_idx" ON "principals" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "charge_types_category_idx" ON "charge_types" USING btree ("category","sort_order");--> statement-breakpoint
CREATE INDEX "free_time_rules_lookup_idx" ON "free_time_rules" USING btree ("kind","branch_id","mode");--> statement-breakpoint
CREATE INDEX "fx_rates_lookup_idx" ON "fx_rates" USING btree ("from_currency","to_currency","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_unlocode_idx" ON "locations" USING btree ("unlocode");--> statement-breakpoint
CREATE INDEX "locations_country_idx" ON "locations" USING btree ("country_code","kind");--> statement-breakpoint
CREATE INDEX "milestone_templates_lookup_idx" ON "milestone_templates" USING btree ("mode","direction","seq");--> statement-breakpoint
CREATE INDEX "customer_contacts_customer_idx" ON "customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("legal_name_en");--> statement-breakpoint
CREATE INDEX "partner_compliance_expiry_idx" ON "partner_compliance" USING btree ("expires_on","partner_id");--> statement-breakpoint
CREATE INDEX "partner_contacts_partner_idx" ON "partner_contacts" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_coverage_lane_idx" ON "partner_coverage" USING btree ("mode","origin_id","destination_id");--> statement-breakpoint
CREATE INDEX "partner_coverage_partner_idx" ON "partner_coverage" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partners_type_idx" ON "partners" USING btree ("type","country_code");--> statement-breakpoint
CREATE INDEX "rate_card_lines_card_idx" ON "rate_card_lines" USING btree ("rate_card_id","sort_order");--> statement-breakpoint
CREATE INDEX "rate_cards_lane_idx" ON "rate_cards" USING btree ("mode","origin_id","destination_id","direction");--> statement-breakpoint
CREATE INDEX "rate_cards_partner_idx" ON "rate_cards" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "rate_cards_customer_idx" ON "rate_cards" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "rate_requests_enquiry_idx" ON "rate_requests" USING btree ("enquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_stages_job_idx" ON "customs_stages" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "customs_stages_status_idx" ON "customs_stages" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "documents_job_idx" ON "documents" USING btree ("job_id","document_type_id","version");--> statement-breakpoint
CREATE INDEX "documents_released_idx" ON "documents" USING btree ("released_at");--> statement-breakpoint
CREATE INDEX "enquiries_board_idx" ON "enquiries" USING btree ("branch_id","status","sla_due_at");--> statement-breakpoint
CREATE INDEX "enquiries_owner_idx" ON "enquiries" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "enquiries_customer_idx" ON "enquiries" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "equipment_job_idx" ON "equipment" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "equipment_container_idx" ON "equipment" USING btree ("container_no");--> statement-breakpoint
CREATE INDEX "exceptions_open_idx" ON "exceptions" USING btree ("closed_at","severity","due_at");--> statement-breakpoint
CREATE INDEX "exceptions_job_idx" ON "exceptions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "free_time_clocks_open_idx" ON "free_time_clocks" USING btree ("ends_on","kind");--> statement-breakpoint
CREATE INDEX "free_time_clocks_job_idx" ON "free_time_clocks" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_milestones_job_idx" ON "job_milestones" USING btree ("job_id","seq");--> statement-breakpoint
CREATE INDEX "job_milestones_due_idx" ON "job_milestones" USING btree ("actual_at","planned_at");--> statement-breakpoint
CREATE INDEX "job_partners_partner_idx" ON "job_partners" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "jobs_board_idx" ON "jobs" USING btree ("branch_id","status","eta");--> statement-breakpoint
CREATE INDEX "jobs_customer_idx" ON "jobs" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "jobs_owner_idx" ON "jobs" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "quote_lines" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "accounting_exports_period_idx" ON "accounting_exports" USING btree ("branch_id","period_from");--> statement-breakpoint
CREATE INDEX "charge_lines_job_idx" ON "charge_lines" USING btree ("job_id","direction");--> statement-breakpoint
CREATE INDEX "charge_lines_unbilled_idx" ON "charge_lines" USING btree ("branch_id","invoice_id","direction");--> statement-breakpoint
CREATE INDEX "charge_lines_source_idx" ON "charge_lines" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id","sort_order");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "invoices_ageing_idx" ON "invoices" USING btree ("branch_id","status","due_on");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id","received_on");--> statement-breakpoint
CREATE INDEX "message_attachments_message_idx" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_job_idx" ON "messages" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_enquiry_idx" ON "messages" USING btree ("enquiry_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_external_idx" ON "messages" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "notification_deliveries_outbox_idx" ON "notification_deliveries" USING btree ("outbox_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status","deferred_until");--> statement-breakpoint
CREATE INDEX "notification_deliveries_external_idx" ON "notification_deliveries" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("dispatched_at","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_customer_idx" ON "webhook_endpoints" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "audit_log_row_idx" ON "audit_log" USING btree ("table_name","row_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_principal_idx" ON "audit_log" USING btree ("principal_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");