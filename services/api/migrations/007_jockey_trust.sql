-- Add v4 and explicit event effects without rewriting any stored Run/Log/result or existing relationship.
ALTER TABLE race_runs DROP CONSTRAINT race_runs_engine_version_check;
ALTER TABLE race_runs ADD CONSTRAINT race_runs_engine_version_check
  CHECK (engine_version IN ('race-sim-v1','race-sim-v2','race-sim-v3','race-sim-v4'));
ALTER TABLE event_effects DROP CONSTRAINT event_effects_effect_type_check;
ALTER TABLE event_effects ADD CONSTRAINT event_effects_effect_type_check
  CHECK (effect_type IN ('value_delta','action_modifier','resolved_growth_bonus','jockey_trust'));

CREATE FUNCTION guard_retired_jockey_relation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.horse_id <> OLD.horse_id OR NEW.jockey_id <> OLD.jockey_id) THEN
    RAISE EXCEPTION 'Immutable relationship identity' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM careers WHERE horse_id = CASE WHEN TG_OP='DELETE' THEN OLD.horse_id ELSE NEW.horse_id END AND status='retired') THEN
    RAISE EXCEPTION 'Retired horse relationship is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_retired_jockey_relation BEFORE INSERT OR UPDATE OR DELETE ON jockey_chemistry
  FOR EACH ROW EXECUTE FUNCTION guard_retired_jockey_relation();
