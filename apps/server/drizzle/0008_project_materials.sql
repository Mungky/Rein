CREATE TABLE "project_materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"part_no" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"material" text DEFAULT '' NOT NULL,
	"specification" text DEFAULT '' NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text NOT NULL,
	"status" text DEFAULT 'not_available' NOT NULL,
	"received_at" date,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"creation_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_materials_quantity_check" CHECK ("project_materials"."quantity" > 0),
	CONSTRAINT "project_materials_status_check" CHECK ("project_materials"."status" in ('in_stock', 'not_available', 'po'))
);
--> statement-breakpoint
ALTER TABLE "logbook_entries" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "project_materials" ADD CONSTRAINT "project_materials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_materials" ADD CONSTRAINT "project_materials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_materials_project_idx" ON "project_materials" USING btree ("project_id","created_at");