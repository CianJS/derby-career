-- Historical approval snapshots are additive. This does not approve or activate a race.
CREATE TABLE official_race_mapping_history (
  race_definition_id text NOT NULL,
  revision text NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
  source_race_id text NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (race_definition_id, revision)
);
CREATE TRIGGER immutable_official_mapping_history
  BEFORE UPDATE OR DELETE ON official_race_mapping_history
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
