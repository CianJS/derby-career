-- Additive only: do not rewrite historical RaceRun input, receipts, results or retirement JSON.
ALTER TABLE stables ADD COLUMN home_country text NOT NULL DEFAULT 'KOR'
  CHECK (home_country ~ '^[A-Z]{3}$');
ALTER TABLE stables ADD COLUMN travel_revision integer NOT NULL DEFAULT 0 CHECK (travel_revision >= 0);
ALTER TABLE race_definitions ADD COLUMN country_code text CHECK (country_code ~ '^[A-Z]{3}$');
-- Only the original development fixtures had an implicit domestic (Korean) meaning.
UPDATE race_definitions SET country_code=COALESCE(payload->>'countryCode','KOR')
WHERE source_kind='development_fixture' AND id IN (
  'DEV_M3_SPRINT_1400','DEV_M3_MILE_1600','DEV_M3_MIDDLE_2000',
  'DEV_M6_MAIDEN_MILE_1600','DEV_M6_MAIDEN_MIDDLE_2200','DEV_M6_ONE_WIN_1800',
  'DEV_M6_ONE_WIN_LONG_2400','DEV_M6_LISTED_2000','DEV_M9_MAIDEN_SPRINT_1400',
  'DEV_M9_MAIDEN_MIDDLE_1800','DEV_M9_ONE_WIN_1600','DEV_M9_ONE_WIN_2000',
  'DEV_M9_LISTED_1800','DEV_M12_MAIDEN_MIDDLE_2000','DEV_M12_ONE_WIN_1600',
  'DEV_M12_ONE_WIN_LONG_2400','DEV_M12_LISTED_2200'
);
ALTER TABLE careers ADD CONSTRAINT careers_stable_identity UNIQUE(id,stable_id);
CREATE TABLE stable_expeditions (
  id uuid PRIMARY KEY,
  stable_id uuid NOT NULL REFERENCES stables(id),
  career_id uuid NOT NULL,
  target_country text NOT NULL CHECK (target_country IN ('KOR','JPN','USA')),
  target_race_definition_id text REFERENCES race_definitions(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','returned')),
  started_revision integer NOT NULL CHECK (started_revision > 0),
  started_turn integer NOT NULL CHECK (started_turn > 0),
  ended_turn integer CHECK (ended_turn >= started_turn),
  end_reason text CHECK (end_reason IN ('return','retirement')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  FOREIGN KEY(career_id,stable_id) REFERENCES careers(id,stable_id),
  CHECK ((status='active' AND ended_at IS NULL AND ended_turn IS NULL AND end_reason IS NULL)
      OR (status='returned' AND ended_at IS NOT NULL AND ended_turn IS NOT NULL AND end_reason IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_expedition_per_stable ON stable_expeditions(stable_id) WHERE status='active';
CREATE FUNCTION protect_expedition_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable expedition history'; END IF;
  IF OLD.status='returned' OR
     (NEW.id,NEW.stable_id,NEW.career_id,NEW.target_country,NEW.started_revision,NEW.started_turn,NEW.created_at)
       IS DISTINCT FROM
     (OLD.id,OLD.stable_id,OLD.career_id,OLD.target_country,OLD.started_revision,OLD.started_turn,OLD.created_at)
     OR (NEW.status='active' AND (NEW.ended_at IS NOT NULL OR NEW.end_reason IS NOT NULL)) THEN
    RAISE EXCEPTION 'Immutable expedition history';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_expedition_history BEFORE UPDATE OR DELETE ON stable_expeditions
  FOR EACH ROW EXECUTE FUNCTION protect_expedition_history();
