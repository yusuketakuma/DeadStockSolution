CREATE TYPE "public"."openclaw_status_enum" AS ENUM('pending_handoff', 'in_dialogue', 'implementing', 'completed');--> statement-breakpoint
CREATE TABLE "user_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"request_text" text NOT NULL,
	"openclaw_status" "openclaw_status_enum" DEFAULT 'pending_handoff' NOT NULL,
	"openclaw_thread_id" text,
	"openclaw_summary" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_requests" ADD CONSTRAINT "user_requests_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_requests_created_at" ON "user_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_user_requests_pharmacy_created" ON "user_requests" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_user_requests_status_created" ON "user_requests" USING btree ("openclaw_status","created_at");