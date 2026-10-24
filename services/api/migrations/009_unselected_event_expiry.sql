-- An unselected legacy month-start offer may expire when injury leaves no usable choice.
-- Preserve its null choice_id instead of fabricating a player selection. Existing rows and
-- immutable history/draw guards are unchanged; selected/applied rows still require a choice.
ALTER TABLE career_event_history DROP CONSTRAINT career_event_history_check;
ALTER TABLE career_event_history ADD CONSTRAINT career_event_history_check CHECK (
  (state = 'pending' AND choice_id IS NULL)
  OR state = 'expired'
  OR (state IN ('selected','applied') AND choice_id IS NOT NULL)
);
