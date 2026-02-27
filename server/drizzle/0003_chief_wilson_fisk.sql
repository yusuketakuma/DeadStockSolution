CREATE TYPE "public"."special_business_hours_type_enum" AS ENUM('holiday_closed', 'long_holiday_closed', 'temporary_closed', 'special_open');--> statement-breakpoint
CREATE TABLE "pharmacy_special_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"special_type" "special_business_hours_type_enum" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"open_time" text,
	"close_time" text,
	"is_closed" boolean DEFAULT true NOT NULL,
	"is_24_hours" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_special_hours_date_range" CHECK ("pharmacy_special_hours"."start_date" <= "pharmacy_special_hours"."end_date"),
	CONSTRAINT "chk_special_hours_flags" CHECK (NOT ("pharmacy_special_hours"."is_closed" = true AND "pharmacy_special_hours"."is_24_hours" = true))
);
--> statement-breakpoint
ALTER TABLE "pharmacy_special_hours" ADD CONSTRAINT "pharmacy_special_hours_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_special_hours_pharmacy_date" ON "pharmacy_special_hours" USING btree ("pharmacy_id","start_date","end_date");--> statement-breakpoint
