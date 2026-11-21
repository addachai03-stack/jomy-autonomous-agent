CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('checklist','text_report')), input TEXT NOT NULL,
  due_at INTEGER NOT NULL, repeat TEXT NOT NULL CHECK(repeat IN ('once','daily')), status TEXT NOT NULL CHECK(status IN ('queued','done','failed','cancelled')),
  created_at INTEGER NOT NULL, last_run_at INTEGER, result TEXT, run_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status,due_at,id);
CREATE TABLE IF NOT EXISTS scheduler_state (id INTEGER PRIMARY KEY CHECK(id=1),last_tick_at INTEGER NOT NULL,last_completed INTEGER NOT NULL,last_failed INTEGER NOT NULL);
