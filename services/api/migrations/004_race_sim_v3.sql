-- Keep every stored v1/v2 run and its immutable log unchanged. Only widen the accepted engine set.
ALTER TABLE race_runs DROP CONSTRAINT race_runs_engine_version_check;
ALTER TABLE race_runs ADD CONSTRAINT race_runs_engine_version_check
  CHECK (engine_version IN ('race-sim-v1', 'race-sim-v2', 'race-sim-v3'));
