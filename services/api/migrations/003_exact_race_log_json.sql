-- v1/v2 digest uses JSON.stringify, so object key order is part of the existing engine contract.
-- JSONB cannot preserve it. Keep the exact original JSON alongside queryable metadata/JSONB.
ALTER TABLE race_simulation_logs ADD COLUMN log_json text;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM race_simulation_logs) THEN
    RAISE EXCEPTION 'Exact log JSON is required: do not reconstruct existing logs from JSONB or reroll results';
  END IF;
END $$;
ALTER TABLE race_simulation_logs ALTER COLUMN log_json SET NOT NULL;
ALTER TABLE race_simulation_logs ADD CONSTRAINT exact_log_matches_jsonb CHECK (log_json::jsonb = log);
