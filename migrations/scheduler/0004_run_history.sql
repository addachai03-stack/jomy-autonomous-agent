-- Persist latest cloud checks while keeping a strict bounded history size.
CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('done','queued','failed')),
  result TEXT NOT NULL,
  UNIQUE(job_id,ran_at)
);
