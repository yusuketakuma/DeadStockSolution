CREATE TYPE "public"."pharmacy_relationship_type_enum" AS ENUM('favorite', 'blocked');--> statement-breakpoint
CREATE TABLE "pharmacy_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"target_pharmacy_id" integer NOT NULL,
	"relationship_type" "pharmacy_relationship_type_enum" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "pharmacy_relationships" ADD CONSTRAINT "pharmacy_relationships_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_relationships" ADD CONSTRAINT "pharmacy_relationships_target_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("target_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relationships_pharmacy" ON "pharmacy_relationships" USING btree ("pharmacy_id","relationship_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_relationships_unique" ON "pharmacy_relationships" USING btree ("pharmacy_id","target_pharmacy_id");