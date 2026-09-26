-- =====================================================================
-- Winter League Platform — Migration 008: adding and removing games
--
-- 1. Games can now be ADDED by hand (not only by the matchmaker). The
--    games table records who added one, when, why, and, when the game
--    breaks a league rule on purpose (another division, same program, over
--    the rematch limit), which rule it's an exception to.
--
-- 2. Coaches and directors can REQUEST an added game on the published
--    schedule, through the same approval chain as a move, swap, or cancel.
--    The game doesn't exist until the league approves, so:
--      • change_requests.game_id may now be empty (it's filled in with the
--        new game when the request is approved);
--      • type allows 'add';
--      • run_id, add_home_team_id and add_away_team_id record which
--        schedule and which two teams the new game is for.
--    SQLite can't change a column's NOT NULL or CHECK in place, so the
--    table is rebuilt and its rows copied (as in migration 007).
-- =====================================================================

ALTER TABLE games ADD COLUMN added_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE games ADD COLUMN added_at TEXT;
ALTER TABLE games ADD COLUMN added_reason TEXT;
ALTER TABLE games ADD COLUMN exception_note TEXT;

CREATE TABLE change_requests_new (
  id                     TEXT PRIMARY KEY,
  game_id                TEXT REFERENCES games(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL CHECK (type IN ('reschedule', 'swap', 'cancel', 'add')),
  swap_game_id           TEXT REFERENCES games(id) ON DELETE CASCADE,
  run_id                 TEXT REFERENCES schedule_runs(id) ON DELETE CASCADE,
  add_home_team_id       TEXT REFERENCES teams(id) ON DELETE CASCADE,
  add_away_team_id       TEXT REFERENCES teams(id) ON DELETE CASCADE,
  proposed_court_id      TEXT REFERENCES courts(id) ON DELETE SET NULL,
  proposed_date          TEXT,
  proposed_start_time    TEXT,
  proposed_end_time      TEXT,
  reason                 TEXT NOT NULL,
  snapshot               TEXT,
  requested_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  requesting_program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL CHECK (status IN (
                           'pending_director', 'pending_counterpart', 'pending_admin',
                           'approved', 'denied', 'cancelled')),
  decision_note          TEXT,
  decided_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at             TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  -- Every request except an added game is about an existing game.
  CHECK (type = 'add' OR game_id IS NOT NULL)
);

INSERT INTO change_requests_new (id, game_id, type, swap_game_id, proposed_court_id, proposed_date, proposed_start_time, proposed_end_time,
  reason, snapshot, requested_by, requesting_program_id, status, decision_note, decided_by, decided_at, created_at, updated_at)
  SELECT id, game_id, type, swap_game_id, proposed_court_id, proposed_date, proposed_start_time, proposed_end_time,
    reason, snapshot, requested_by, requesting_program_id, status, decision_note, decided_by, decided_at, created_at, updated_at
  FROM change_requests;

-- change_request_steps points at change_requests with ON DELETE CASCADE, so
-- keep a copy of the approval steps and put them back after the swap.
CREATE TABLE change_request_steps_backup AS SELECT * FROM change_request_steps;

DROP TABLE change_requests;
ALTER TABLE change_requests_new RENAME TO change_requests;

INSERT INTO change_request_steps (id, request_id, stage, program_id, decision, decided_by, decided_at, note)
  SELECT id, request_id, stage, program_id, decision, decided_by, decided_at, note FROM change_request_steps_backup
  WHERE id NOT IN (SELECT id FROM change_request_steps);
DROP TABLE change_request_steps_backup;

CREATE INDEX IF NOT EXISTS idx_requests_status ON change_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_game ON change_requests(game_id);
CREATE INDEX IF NOT EXISTS idx_requests_program ON change_requests(requesting_program_id);
CREATE INDEX IF NOT EXISTS idx_requests_run ON change_requests(run_id);
