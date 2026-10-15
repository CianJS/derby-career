-- Reference-only catalog. No links to Career/RaceRun or playable race_definitions.
CREATE TABLE racecourses (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  source_row jsonb NOT NULL,
  source_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payload->>'id' IS NOT DISTINCT FROM id),
  CHECK (payload->'gameEnabled' IS NOT DISTINCT FROM 'false'::jsonb)
);
CREATE TABLE racecourse_courses (
  id text PRIMARY KEY,
  racecourse_id text NOT NULL REFERENCES racecourses(id),
  payload jsonb NOT NULL,
  source_row jsonb NOT NULL,
  source_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, racecourse_id),
  CHECK (payload->>'id' IS NOT DISTINCT FROM id),
  CHECK (payload->>'racecourseId' IS NOT DISTINCT FROM racecourse_id),
  CHECK (payload->'gameEnabled' IS NOT DISTINCT FROM 'false'::jsonb)
);
CREATE TABLE race_schedules (
  id text PRIMARY KEY,
  racecourse_id text NOT NULL REFERENCES racecourses(id),
  course_id text,
  race_date date,
  payload jsonb NOT NULL,
  source_row jsonb NOT NULL,
  source_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (course_id, racecourse_id) REFERENCES racecourse_courses(id, racecourse_id),
  CHECK (payload->>'id' IS NOT DISTINCT FROM id),
  CHECK (payload->>'racecourseId' IS NOT DISTINCT FROM racecourse_id),
  CHECK (payload->>'courseId' IS NOT DISTINCT FROM course_id),
  CHECK (payload->>'raceDate' IS NOT DISTINCT FROM to_char(race_date, 'YYYY-MM-DD')),
  CHECK (payload->'gameEnabled' IS NOT DISTINCT FROM 'false'::jsonb),
  CHECK (payload->>'entryEligibility' IS NOT DISTINCT FROM 'not_evaluated'),
  CHECK ((race_date IS NOT NULL AND payload->>'scheduleStatus' = 'dated') OR
    (race_date IS NULL AND payload->>'scheduleStatus' IN ('date_unconfirmed','not_run')))
);
CREATE INDEX racecourses_country ON racecourses ((payload->>'countryCode'), id);
CREATE INDEX racecourse_courses_parent ON racecourse_courses (racecourse_id, id);
CREATE INDEX race_schedules_date ON race_schedules (race_date ASC NULLS LAST, id COLLATE "C");
CREATE INDEX race_schedules_country_year ON race_schedules ((payload->>'country'), (payload->>'year'));
CREATE INDEX race_schedules_racecourse ON race_schedules (racecourse_id);
