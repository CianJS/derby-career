CREATE FUNCTION guard_event_draw() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Immutable monthly draw' USING ERRCODE='23514'; END IF;
  IF NEW.career_id <> OLD.career_id OR NEW.turn <> OLD.turn OR NEW.seed <> OLD.seed OR NEW.system_version <> OLD.system_version
    OR NEW.config <> OLD.config OR NEW.pool <> OLD.pool OR NEW.gate_passed <> OLD.gate_passed OR NEW.deferred_to_result <> OLD.deferred_to_result
    OR (OLD.finished AND NOT NEW.finished) THEN
    RAISE EXCEPTION 'Immutable monthly draw identity/config/pool' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_event_draw_identity BEFORE UPDATE OR DELETE ON event_draws FOR EACH ROW EXECUTE FUNCTION guard_event_draw();
CREATE FUNCTION guard_event_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable event history' USING ERRCODE='23514'; END IF;
  IF NEW.id<>OLD.id OR NEW.career_id<>OLD.career_id OR NEW.turn<>OLD.turn OR NEW.event_id<>OLD.event_id OR NEW.event_revision<>OLD.event_revision OR NEW.definition_snapshot<>OLD.definition_snapshot
    OR (OLD.choice_id IS NOT NULL AND NEW.choice_id IS DISTINCT FROM OLD.choice_id)
    OR (OLD.state IN ('applied','expired') AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Immutable event selection/result' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_event_history_identity BEFORE UPDATE OR DELETE ON career_event_history FOR EACH ROW EXECUTE FUNCTION guard_event_history();
CREATE FUNCTION guard_monthly_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable monthly action' USING ERRCODE='23514'; END IF;
  IF NEW.id<>OLD.id OR NEW.career_id<>OLD.career_id OR NEW.horse_id<>OLD.horse_id OR NEW.turn<>OLD.turn OR NEW.kind<>OLD.kind OR NEW.request_hash<>OLD.request_hash
    OR (OLD.resolved_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Immutable monthly action identity/result' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_monthly_action BEFORE UPDATE OR DELETE ON monthly_actions FOR EACH ROW EXECUTE FUNCTION guard_monthly_action();
CREATE TRIGGER immutable_owned_horse_identity BEFORE UPDATE OR DELETE ON owned_horses FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
