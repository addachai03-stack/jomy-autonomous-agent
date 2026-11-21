-- Optional AI review, disabled by default. One durable claim per UTC day.
ALTER TABLE jobs ADD COLUMN ai_requested INTEGER NOT NULL DEFAULT 0 CHECK(ai_requested IN (0,1));
CREATE TABLE IF NOT EXISTS ai_review_budget(day TEXT PRIMARY KEY);
