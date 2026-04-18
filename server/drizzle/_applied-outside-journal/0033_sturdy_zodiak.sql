CREATE TYPE "public"."group_member_role_enum" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."pharmacy_group_visibility_enum" AS ENUM('public', 'invite_only');--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"role" "group_member_role_enum" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "pharmacy_group_visibility_enum" DEFAULT 'invite_only' NOT NULL,
	"owner_pharmacy_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now(),
	"last_used_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "matching_rule_profiles" ADD COLUMN "group_bonus" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_pharmacy_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."pharmacy_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_groups" ADD CONSTRAINT "pharmacy_groups_owner_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("owner_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_group_members_unique" ON "group_members" USING btree ("group_id","pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_group_members_group" ON "group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_group_members_pharmacy" ON "group_members" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_pharmacy_groups_owner" ON "pharmacy_groups" USING btree ("owner_pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_pharmacy_groups_visibility" ON "pharmacy_groups" USING btree ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_push_subscriptions_unique" ON "push_subscriptions" USING btree ("pharmacy_id","endpoint");--> statement-breakpoint
CREATE INDEX "idx_push_subscriptions_pharmacy" ON "push_subscriptions" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_push_subscriptions_created" ON "push_subscriptions" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "matching_rule_profiles" ADD CONSTRAINT "chk_matching_rule_group_bonus" CHECK ("matching_rule_profiles"."group_bonus" >= 0 AND "matching_rule_profiles"."group_bonus" <= 50);