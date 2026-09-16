ALTER TYPE "public"."ai_surface" ADD VALUE 'quote_cover_note';--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "cover_note_en" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "cover_note_ar" text;