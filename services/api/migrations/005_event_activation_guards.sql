-- Immutable old revisions and current Career snapshots remain untouched.
-- A direct enabled flag update cannot bypass explicit review of expansion content.
CREATE FUNCTION guard_expansion_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE definition jsonb;
BEGIN
  IF NEW.enabled AND (NEW.category <> 'common' OR NEW.id ~ '^(GEN|SPC|ACC|HID)-') THEN
    SELECT r.definition INTO definition FROM event_revisions r
      WHERE r.event_id=NEW.id AND r.revision=NEW.current_revision;
    IF definition IS NULL OR NOT (
      definition->>'enabled' = 'true' AND definition->>'status' = 'ready'
      AND definition->'review'->>'converted' = 'true'
      AND definition->'review'->>'executable' = 'true'
      AND definition->'review'->>'contentReviewed' = 'true'
      AND definition->'review'->>'balanceReviewed' = 'true'
    ) IS TRUE THEN
      RAISE EXCEPTION 'Unreviewed event cannot be activated: %',NEW.id USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER reviewed_expansion_activation AFTER INSERT OR UPDATE ON event_definitions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_expansion_activation();
