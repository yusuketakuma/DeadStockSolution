# Applied outside the drizzle journal

These SQL files were generated for earlier feature branches but never
registered in `../meta/_journal.json`. The DDL inside each file is already
applied to preview + prod (schema.ts is the current source of truth), so
re-running them would fail with "relation already exists" or column
duplication errors.

They are archived here (and **not** loaded by `drizzle-kit migrate`) to:

- keep historical context for incident review
- document which migrations bypassed the journal so future `drizzle-kit
  generate` runs can pick up the schema.ts ↔ journal delta cleanly
- avoid re-applying CREATE TABLE / ALTER TABLE statements on live DBs

Journal state: entries[0..28] cover `0000_daffy_king_bedlam` →
`0043_push_notification_preferences`. The jump from idx 21 (`0021_clean_warpath`)
to idx 22 (`0037_dds_remote_agent`) is a historical artefact of a messy
branch merge — do not try to "fix" it by re-inserting entries; let the next
`drizzle-kit generate` produce a fresh migration that captures the current
schema.ts ↔ live DB delta.

Recovery of the missing tables/columns was performed on 2026-04-19 via
`server/src/scripts/_recover-missing-schema.ts` (see that file for the exact
DDL applied).
