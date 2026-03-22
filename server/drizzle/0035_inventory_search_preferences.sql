CREATE TABLE "inventory_search_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "pharmacy_id" integer NOT NULL,
  "draft_json" jsonb NOT NULL,
  "search_history_json" jsonb NOT NULL,
  "saved_presets_json" jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "inventory_search_preferences"
  ADD CONSTRAINT "inventory_search_preferences_pharmacy_id_pharmacies_id_fk"
  FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_inventory_search_preferences_pharmacy"
  ON "inventory_search_preferences" USING btree ("pharmacy_id");
