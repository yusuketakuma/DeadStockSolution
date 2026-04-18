CREATE TABLE IF NOT EXISTS "matching_rule_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "profile_name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "name_match_threshold" real DEFAULT 0.7 NOT NULL,
  "value_score_max" real DEFAULT 55 NOT NULL,
  "value_score_divisor" real DEFAULT 2500 NOT NULL,
  "balance_score_max" real DEFAULT 20 NOT NULL,
  "balance_score_diff_factor" real DEFAULT 1.5 NOT NULL,
  "distance_score_max" real DEFAULT 15 NOT NULL,
  "distance_score_divisor" real DEFAULT 8 NOT NULL,
  "distance_score_fallback" real DEFAULT 2 NOT NULL,
  "near_expiry_score_max" real DEFAULT 10 NOT NULL,
  "near_expiry_item_factor" real DEFAULT 1.5 NOT NULL,
  "near_expiry_days" integer DEFAULT 120 NOT NULL,
  "diversity_score_max" real DEFAULT 10 NOT NULL,
  "diversity_item_factor" real DEFAULT 1.5 NOT NULL,
  "favorite_bonus" real DEFAULT 15 NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "chk_matching_rule_name_threshold" CHECK ("name_match_threshold" >= 0 AND "name_match_threshold" <= 1),
  CONSTRAINT "chk_matching_rule_value_score_max" CHECK ("value_score_max" >= 0),
  CONSTRAINT "chk_matching_rule_value_score_divisor" CHECK ("value_score_divisor" > 0),
  CONSTRAINT "chk_matching_rule_balance_score_max" CHECK ("balance_score_max" >= 0),
  CONSTRAINT "chk_matching_rule_balance_diff_factor" CHECK ("balance_score_diff_factor" >= 0),
  CONSTRAINT "chk_matching_rule_distance_score_max" CHECK ("distance_score_max" >= 0),
  CONSTRAINT "chk_matching_rule_distance_score_divisor" CHECK ("distance_score_divisor" > 0),
  CONSTRAINT "chk_matching_rule_distance_fallback" CHECK ("distance_score_fallback" >= 0),
  CONSTRAINT "chk_matching_rule_near_expiry_score_max" CHECK ("near_expiry_score_max" >= 0),
  CONSTRAINT "chk_matching_rule_near_expiry_item_factor" CHECK ("near_expiry_item_factor" >= 0),
  CONSTRAINT "chk_matching_rule_near_expiry_days" CHECK ("near_expiry_days" >= 1 AND "near_expiry_days" <= 365),
  CONSTRAINT "chk_matching_rule_diversity_score_max" CHECK ("diversity_score_max" >= 0),
  CONSTRAINT "chk_matching_rule_diversity_item_factor" CHECK ("diversity_item_factor" >= 0),
  CONSTRAINT "chk_matching_rule_favorite_bonus" CHECK ("favorite_bonus" >= 0),
  CONSTRAINT "chk_matching_rule_version" CHECK ("version" >= 1)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_matching_rule_profiles_name_unique"
  ON "matching_rule_profiles" ("profile_name");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_matching_rule_profiles_active_unique"
  ON "matching_rule_profiles" ("is_active")
  WHERE "is_active" = true;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_matching_rule_profiles_updated_at"
  ON "matching_rule_profiles" ("updated_at");
--> statement-breakpoint

INSERT INTO "matching_rule_profiles" (
  "profile_name",
  "is_active",
  "name_match_threshold",
  "value_score_max",
  "value_score_divisor",
  "balance_score_max",
  "balance_score_diff_factor",
  "distance_score_max",
  "distance_score_divisor",
  "distance_score_fallback",
  "near_expiry_score_max",
  "near_expiry_item_factor",
  "near_expiry_days",
  "diversity_score_max",
  "diversity_item_factor",
  "favorite_bonus",
  "version",
  "created_at",
  "updated_at"
) VALUES (
  'default',
  true,
  0.7,
  55,
  2500,
  20,
  1.5,
  15,
  8,
  2,
  10,
  1.5,
  120,
  10,
  1.5,
  15,
  1,
  now(),
  now()
)
ON CONFLICT ("profile_name") DO NOTHING;
--> statement-breakpoint

UPDATE "matching_rule_profiles"
SET "is_active" = true,
    "updated_at" = now()
WHERE "id" = (
  SELECT "id"
  FROM "matching_rule_profiles"
  ORDER BY "id" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1
  FROM "matching_rule_profiles"
  WHERE "is_active" = true
);
