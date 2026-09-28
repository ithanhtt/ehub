CREATE TABLE "metric_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"metric" text NOT NULL,
	"amount" bigint NOT NULL,
	"spread" text DEFAULT 'total' NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metric_adjustments" ADD CONSTRAINT "metric_adjustments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_adjustments" ADD CONSTRAINT "metric_adjustments_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_adjustments_project_idx" ON "metric_adjustments" USING btree ("project_id","start_on");