CREATE TABLE principals (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('development', 'external')),
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES principals(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_principal ON sessions(principal_id);

CREATE TABLE horse_definitions (
  id text PRIMARY KEY, payload jsonb NOT NULL, source_kind text NOT NULL CHECK (source_kind IN ('development_fixture', 'catalog'))
);
CREATE TABLE horse_aptitudes (
  horse_definition_id text NOT NULL REFERENCES horse_definitions(id),
  aptitude text NOT NULL, grade text NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D')),
  PRIMARY KEY (horse_definition_id, aptitude)
);
CREATE TABLE jockey_definitions (
  id text PRIMARY KEY, payload jsonb NOT NULL, source_kind text NOT NULL CHECK (source_kind IN ('development_fixture', 'catalog'))
);
CREATE TABLE race_definitions (
  id text PRIMARY KEY, payload jsonb NOT NULL, source_kind text NOT NULL CHECK (source_kind IN ('development_fixture', 'catalog'))
);

CREATE TABLE event_definitions (
  id text PRIMARY KEY, name text NOT NULL,
  category text NOT NULL CHECK (category IN ('common','normal','special','accident','hidden')),
  status text NOT NULL CHECK (status IN ('ready','needs_mapping','deferred')),
  enabled boolean NOT NULL DEFAULT false, current_revision char(64) NOT NULL,
  CHECK (NOT enabled OR status = 'ready')
);
CREATE TABLE event_revisions (
  event_id text NOT NULL REFERENCES event_definitions(id), revision char(64) NOT NULL,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, revision)
);
ALTER TABLE event_definitions ADD CONSTRAINT event_current_revision
  FOREIGN KEY (id, current_revision) REFERENCES event_revisions(event_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE event_choices (
  event_id text NOT NULL, revision char(64) NOT NULL, choice_id text NOT NULL,
  label text NOT NULL, conditions jsonb NOT NULL CHECK (jsonb_typeof(conditions) = 'array'),
  PRIMARY KEY (event_id,revision,choice_id),
  FOREIGN KEY (event_id,revision) REFERENCES event_revisions(event_id,revision)
);
CREATE TABLE event_effects (
  event_id text NOT NULL, revision char(64) NOT NULL, choice_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  effect_type text NOT NULL CHECK (effect_type IN ('value_delta','action_modifier','resolved_growth_bonus')),
  payload jsonb NOT NULL CHECK (payload->>'type' = effect_type),
  PRIMARY KEY (event_id,revision,choice_id,ordinal),
  FOREIGN KEY (event_id,revision,choice_id) REFERENCES event_choices(event_id,revision,choice_id)
);
CREATE INDEX event_catalog_filter ON event_definitions(category,enabled,status,id);

CREATE TABLE stables (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES principals(id),
  funds bigint NOT NULL DEFAULT 20000000 CHECK (funds >= 0 AND funds <= 9007199254740991),
  calendar_year integer NOT NULL DEFAULT 2028 CHECK (calendar_year > 0),
  calendar_month integer NOT NULL DEFAULT 4 CHECK (calendar_month BETWEEN 1 AND 12),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (owner_id), UNIQUE(id,owner_id)
);
CREATE TABLE jockey_contracts (
  stable_id uuid NOT NULL REFERENCES stables(id), jockey_id text NOT NULL REFERENCES jockey_definitions(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (stable_id,jockey_id)
);
CREATE TABLE owned_horses (
  id uuid PRIMARY KEY, stable_id uuid NOT NULL REFERENCES stables(id),
  definition_id text NOT NULL REFERENCES horse_definitions(id), definition_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id,stable_id)
);
CREATE TABLE jockey_chemistry (
  horse_id uuid NOT NULL REFERENCES owned_horses(id), jockey_id text NOT NULL REFERENCES jockey_definitions(id),
  chemistry integer NOT NULL DEFAULT 0 CHECK (chemistry BETWEEN 0 AND 100),
  starts integer NOT NULL DEFAULT 0 CHECK (starts >= 0), PRIMARY KEY (horse_id,jockey_id)
);

CREATE FUNCTION valid_career_state(s jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; n numeric;
BEGIN
  IF s IS NULL OR jsonb_typeof(s) <> 'object' OR jsonb_typeof(s->'values') <> 'object' THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['speed','stamina','power','guts','intelligence','fatigue','bodyLoad'] LOOP
    IF jsonb_typeof(s->'values'->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    n := (s->'values'->>k)::numeric;
    IF n < 0 OR (k NOT IN ('fatigue','bodyLoad') AND n > 1000) THEN RETURN false; END IF;
  END LOOP;
  RETURN COALESCE(jsonb_typeof(s->'health') = 'string' AND jsonb_typeof(s->'condition') = 'string',false);
END $$;
CREATE TABLE careers (
  id uuid PRIMARY KEY, stable_id uuid NOT NULL, owner_id uuid NOT NULL,
  horse_id uuid NOT NULL UNIQUE, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  turn integer NOT NULL CHECK (turn > 0), revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state jsonb NOT NULL CHECK (valid_career_state(state)),
  seed text NOT NULL, event_misses integer NOT NULL DEFAULT 0 CHECK (event_misses >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (stable_id,owner_id) REFERENCES stables(id,owner_id),
  FOREIGN KEY (horse_id,stable_id) REFERENCES owned_horses(id,stable_id),
  CHECK (jsonb_typeof(state->'careerTurnIndex') IS NOT DISTINCT FROM 'number' AND (state->>'careerTurnIndex')::integer = turn),
  CHECK (jsonb_typeof(state->'horse'->'id') IS NOT DISTINCT FROM 'string' AND state->'horse'->>'id' = horse_id::text), UNIQUE(id,horse_id)
);
CREATE UNIQUE INDEX one_active_career_per_stable ON careers(stable_id) WHERE status = 'active';
CREATE INDEX careers_owner ON careers(owner_id,id);
COMMENT ON COLUMN careers.state IS 'Authoritative pure-domain aggregate: includes horse stats/health; histories are persisted separately in the same transaction. Never accept a client state snapshot.';

CREATE TABLE monthly_actions (
  id uuid PRIMARY KEY, career_id uuid NOT NULL, horse_id uuid NOT NULL, turn integer NOT NULL CHECK (turn > 0),
  kind text NOT NULL CHECK (kind IN ('training','rest','treatment','race')),
  domain_record jsonb, request_hash char(64) NOT NULL, result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  FOREIGN KEY (career_id,horse_id) REFERENCES careers(id,horse_id),
  UNIQUE(career_id,turn), UNIQUE(id,career_id,turn)
);
CREATE TABLE event_draws (
  career_id uuid NOT NULL REFERENCES careers(id), turn integer NOT NULL CHECK (turn > 0),
  seed text NOT NULL, system_version text NOT NULL, config jsonb NOT NULL, pool jsonb NOT NULL,
  gate_passed boolean NOT NULL, deferred_to_result boolean NOT NULL, evaluated_timings jsonb NOT NULL DEFAULT '[]',
  finished boolean NOT NULL DEFAULT false,
  PRIMARY KEY(career_id,turn)
);
CREATE TABLE career_event_history (
  id uuid PRIMARY KEY, career_id uuid NOT NULL, turn integer NOT NULL,
  event_id text NOT NULL, event_revision char(64) NOT NULL,
  choice_id text, state text NOT NULL CHECK (state IN ('pending','selected','applied','expired')),
  definition_snapshot jsonb NOT NULL, modifiers jsonb NOT NULL DEFAULT '[]',
  result jsonb, selected_at timestamptz, applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(career_id,turn),
  FOREIGN KEY(career_id,turn) REFERENCES event_draws(career_id,turn),
  FOREIGN KEY(event_id,event_revision) REFERENCES event_revisions(event_id,revision),
  FOREIGN KEY(event_id,event_revision,choice_id) REFERENCES event_choices(event_id,revision,choice_id),
  CHECK ((state = 'pending') = (choice_id IS NULL)),
  CHECK (state NOT IN ('applied','expired') OR applied_at IS NOT NULL)
);
CREATE TABLE race_runs (
  id uuid PRIMARY KEY, career_id uuid NOT NULL, turn integer NOT NULL,
  action_id uuid NOT NULL UNIQUE, race_definition_id text NOT NULL REFERENCES race_definitions(id),
  jockey_id text NOT NULL REFERENCES jockey_definitions(id), seed text NOT NULL,
  engine_version text NOT NULL CHECK (engine_version IN ('race-sim-v1','race-sim-v2')),
  input jsonb NOT NULL, health_at_entry text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(action_id,career_id,turn) REFERENCES monthly_actions(id,career_id,turn),
  UNIQUE(career_id,turn), UNIQUE(id,career_id)
);
CREATE TABLE race_simulation_logs (
  race_run_id uuid PRIMARY KEY REFERENCES race_runs(id), engine_version text NOT NULL,
  digest text NOT NULL, duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  storage_version integer NOT NULL DEFAULT 1, byte_length integer NOT NULL CHECK (byte_length > 0), log jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE race_results (
  race_run_id uuid PRIMARY KEY, career_id uuid NOT NULL,
  finish_position integer NOT NULL CHECK (finish_position > 0), prize_money bigint NOT NULL CHECK (prize_money >= 0),
  result jsonb NOT NULL, career_record jsonb NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(race_run_id,career_id) REFERENCES race_runs(id,career_id)
);
CREATE TABLE stable_ledger (
  id uuid PRIMARY KEY, stable_id uuid NOT NULL REFERENCES stables(id), race_run_id uuid NOT NULL REFERENCES race_runs(id),
  kind text NOT NULL CHECK (kind IN ('entry_fee','prize')), amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(race_run_id,kind)
);
CREATE TABLE career_records (
  career_id uuid PRIMARY KEY REFERENCES careers(id), snapshot jsonb NOT NULL, retirement_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commands (
  principal_id uuid NOT NULL REFERENCES principals(id), request_id uuid NOT NULL,
  operation text NOT NULL, career_id uuid REFERENCES careers(id), request_hash char(64) NOT NULL,
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(principal_id,request_id)
);
CREATE FUNCTION forbid_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable history: %', TG_TABLE_NAME USING ERRCODE = '23514'; END $$;
CREATE TRIGGER immutable_event_revisions BEFORE UPDATE OR DELETE ON event_revisions FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER immutable_event_choices BEFORE UPDATE OR DELETE ON event_choices FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER immutable_event_effects BEFORE UPDATE OR DELETE ON event_effects FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER immutable_race_runs BEFORE UPDATE OR DELETE ON race_runs FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER immutable_simulation_logs BEFORE UPDATE OR DELETE ON race_simulation_logs FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER immutable_race_results BEFORE UPDATE OR DELETE ON race_results FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON stable_ledger FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER immutable_career_records BEFORE UPDATE OR DELETE ON career_records FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER immutable_commands BEFORE UPDATE OR DELETE ON commands FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
