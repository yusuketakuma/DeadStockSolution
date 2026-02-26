CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "notifications_pharmacy_id_pharmacies_id_fk"
		FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id")
		ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_pharmacy_unread"
	ON "notifications" USING btree ("pharmacy_id","is_read","created_at");
--> statement-breakpoint
ALTER TABLE IF EXISTS "proposal_comments"
	ADD COLUMN IF NOT EXISTS "read_by_recipient" boolean DEFAULT false NOT NULL;
