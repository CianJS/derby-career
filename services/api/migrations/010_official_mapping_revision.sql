-- Additive metadata only. This migration does not activate or insert any race.
CREATE TABLE IF NOT EXISTS official_race_mapping_revisions (
  race_definition_id text PRIMARY KEY REFERENCES race_definitions(id),
  source_race_id text NOT NULL UNIQUE REFERENCES race_schedules(id),
  revision text NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$')
);
