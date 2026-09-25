ALTER TABLE "bookings" ADD COLUMN "code" text;--> statement-breakpoint
UPDATE "bookings" AS "b" SET "code" = 'BK-' || CASE WHEN "n"."rn" < 10000 THEN lpad("n"."rn"::text, 4, '0') ELSE "n"."rn"::text END FROM (SELECT "id", row_number() OVER (PARTITION BY "project_id" ORDER BY "created_at", "id") AS "rn" FROM "bookings") AS "n" WHERE "b"."id" = "n"."id";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "koc_tier" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "planned_air_on" date;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "result_orders" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "result_revenue" bigint;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "result_source" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "result_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "result_note" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_project_code_unique" ON "bookings" USING btree ("project_id","code");
