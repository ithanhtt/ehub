CREATE TABLE "booking_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"product" text,
	"default_cost" bigint,
	"start_on" date NOT NULL,
	"end_on" date,
	"budget" bigint,
	"target_videos" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "booking_campaigns" ADD CONSTRAINT "booking_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_campaigns" ADD CONSTRAINT "booking_campaigns_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_campaigns_name_unique" ON "booking_campaigns" USING btree ("project_id","name");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_campaign_id_booking_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."booking_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_campaign_idx" ON "bookings" USING btree ("campaign_id");