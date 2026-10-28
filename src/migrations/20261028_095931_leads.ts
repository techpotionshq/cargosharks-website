import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_leads_country" AS ENUM('Kuwait', 'UAE', 'Saudi Arabia', 'Bahrain', 'Oman', 'Qatar', 'Other');
  CREATE TYPE "public"."enum_leads_volume" AS ENUM('Under 50', '50-200', '200-1,000', 'Over 1,000');
  CREATE TYPE "public"."enum_leads_status" AS ENUM('new', 'contacted', 'pilot', 'won', 'lost');
  CREATE TABLE "leads" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"company" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"country" "enum_leads_country",
  	"volume" "enum_leads_volume",
  	"message" varchar,
  	"status" "enum_leads_status" DEFAULT 'new' NOT NULL,
  	"lang" varchar,
  	"page" varchar,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "leads_id" integer;
  CREATE INDEX "leads_updated_at_idx" ON "leads" USING btree ("updated_at");
  CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_leads_fk" FOREIGN KEY ("leads_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_leads_id_idx" ON "payload_locked_documents_rels" USING btree ("leads_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "leads" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "leads" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_leads_fk";
  
  DROP INDEX "payload_locked_documents_rels_leads_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "leads_id";
  DROP TYPE "public"."enum_leads_country";
  DROP TYPE "public"."enum_leads_volume";
  DROP TYPE "public"."enum_leads_status";`)
}
