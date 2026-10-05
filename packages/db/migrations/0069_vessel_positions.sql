CREATE TABLE "vessel_positions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mmsi" text NOT NULL,
	"imo" text,
	"name" text,
	"call_sign" text,
	"ship_type" integer,
	"static_at" timestamp with time zone,
	"latitude" double precision,
	"longitude" double precision,
	"speed_knots" double precision,
	"course_degrees" double precision,
	"heading_degrees" double precision,
	"nav_status" integer,
	"reported_destination" text,
	"reported_eta" timestamp with time zone,
	"position_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"near_location_id" uuid,
	"source" text NOT NULL,
	"track" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "vessel_imo" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "vessel_mmsi" text;--> statement-breakpoint
ALTER TABLE "vessel_positions" ADD CONSTRAINT "vessel_positions_near_location_id_locations_id_fk" FOREIGN KEY ("near_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vessel_positions_mmsi_idx" ON "vessel_positions" USING btree ("mmsi");--> statement-breakpoint
CREATE INDEX "vessel_positions_imo_idx" ON "vessel_positions" USING btree ("imo");--> statement-breakpoint
CREATE INDEX "jobs_vessel_mmsi_idx" ON "jobs" USING btree ("vessel_mmsi");