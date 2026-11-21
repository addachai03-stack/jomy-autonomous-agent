-- Additive migration, preserves jobs and legacy kind constraint.
ALTER TABLE jobs ADD COLUMN action TEXT CHECK(action IS NULL OR (action='website_health' AND kind='text_report'));
