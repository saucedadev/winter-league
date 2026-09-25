-- =====================================================================
-- Winter League Platform — Migration 007: cancelling a game
--
-- Coaches and directors can now ask for a game to be CANCELLED (weather, a
-- gym closure, and so on), through the same approval chain as a move or a
-- swap. A cancelled game stays on the schedule, marked Cancelled with the
-- reason, so there's a record of what happened.
--
-- change_requests.type only allowed 'reschedule' and 'swap', and SQLite
-- can't widen a CHECK in place, so the table is rebuilt and its rows copied.
-- =====================================================================

ALTER TABLE games ADD COLUMN cancel_reason TEXT;
ALTER TABLE games ADD COLUMN cancelled_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE games ADD COLUMN cancelled_at TEXT;

CREATE TABLE change_requests_new (
  id                     TEXT PRIMARY KEY,
  game_id                TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL CHECK (type IN ('reschedule', 'swap', 'cancel')),
  swap_game_id           TEXT REFERENCES games(id) ON DELETE CASCADE,
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
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO change_requests_new (id, game_id, type, swap_game_id, proposed_court_id, proposed_date, proposed_start_time, proposed_end_time,
  reason, snapshot, requested_by, requesting_program_id, status, decision_note, decided_by, decided_at, created_at, updated_at)
  SELECT id, game_id, type, swap_game_id, proposed_court_id, proposed_date, proposed_start_time, proposed_end_time,
    reason, snapshot, requested_by, requesting_program_id, status, decision_note, decided_by, decided_at, created_at, updated_at
  FROM change_requests;

-- change_request_steps points at change_requests with ON DELETE CASCADE, so
-- dropping the old table would take the approval steps with it. Keep a copy
-- and put them back once the new table is in place.
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
