import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" ADD COLUMN "credit" varchar;
  ALTER TABLE "media" ADD COLUMN "credit_url" varchar;
  ALTER TABLE "media" ADD COLUMN "source_id" varchar;
  CREATE INDEX "media_source_id_idx" ON "media" USING btree ("source_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "media_source_id_idx";
  ALTER TABLE "media" DROP COLUMN "credit";
  ALTER TABLE "media" DROP COLUMN "credit_url";
  ALTER TABLE "media" DROP COLUMN "source_id";`)
}
