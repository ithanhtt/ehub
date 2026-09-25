CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"koc_handle" text NOT NULL,
	"koc_name" text,
	"koc_contact" text,
	"booked_on" date NOT NULL,
	"aired_on" date,
	"video_url" text,
	"video_id" text,
	"product" text,
	"cost" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_by_id" text,
	"updated_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_project_aired_idx" ON "bookings" USING btree ("project_id","aired_on");--> statement-breakpoint
CREATE INDEX "bookings_project_koc_idx" ON "bookings" USING btree ("project_id","koc_handle");--> statement-breakpoint
CREATE INDEX "bookings_project_video_idx" ON "bookings" USING btree ("project_id","video_id");