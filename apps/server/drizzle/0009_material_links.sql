CREATE TABLE "work_order_materials" (
	"wo_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_materials_wo_id_material_id_pk" PRIMARY KEY("wo_id","material_id")
);
--> statement-breakpoint
ALTER TABLE "project_materials" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_wo_id_work_orders_id_fk" FOREIGN KEY ("wo_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_material_id_project_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."project_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_order_materials_material_idx" ON "work_order_materials" USING btree ("material_id");