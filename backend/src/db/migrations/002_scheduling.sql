-- =====================================================================
-- Winter League Platform — Migration 002: Phase 2 Scheduling
--
-- Module B: the matchmaker writes a DRAFT schedule (a schedule_run plus
--           its games). A System Admin reviews/edits it, then publishes.
--           Only one run per season is published at a time.
-- Module D: reschedule & swap requests on published games, with a
--           counterpart-approval stage before league sign-off.
--
-- Matchmaker rules live in app_settings under key 'schedule_rules' (JSON).
-- =====================================================================

-- ---------- Schedule runs (one generated schedule) ----------
-- status: draft -> published -> superseded (when a newer run is published)
CREATE TABLE IF NOT EXISTS schedule_runs (
  id            TEXT PRIMARY KEY,
  season_id     TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  rules         TEXT NOT NULL,          -- JSON snapshot of the rules used
  summary       TEXT,                   -- JSON: counts, balance, travel
  warnings      TEXT,                   -- JSON array of plain-English warnings
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  published_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_season ON schedule_runs(season_id, status);

-- ---------- Games ----------
-- A game with status 'unscheduled' is a pairing the matchmaker couldn't
-- place; court/date/time are NULL until someone places it by hand.
CREATE TABLE IF NOT EXISTS games (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES schedule_runs(id) ON DELETE CASCADE,
  season_id       TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  division_id     TEXT NOT NULL REFERENCES divisions(id),
  home_team_id    TEXT NOT NULL REFERENCES teams(id),
  away_team_id    TEXT NOT NULL REFERENCES teams(id),
  court_id        TEXT REFERENCES courts(id) ON DELETE SET NULL,
  gym_slot_id     TEXT REFERENCES gym_slots(id) ON DELETE SET NULL,
  date            TEXT,
  start_time      TEXT,
  end_time        TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'unscheduled', 'cancelled')),
  travel_miles    REAL,
  round           INTEGER,
  note            TEXT,               -- why a game is unscheduled, or an admin note
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (home_team_id != away_team_id)
);
CREATE INDEX IF NOT EXISTS idx_games_run ON games(run_id, date);
CREATE INDEX IF NOT EXISTS idx_games_court_date ON games(court_id, date);
CREATE INDEX IF NOT EXISTS idx_games_home ON games(home_team_id);
CREATE INDEX IF NOT EXISTS idx_games_away ON games(away_team_id);
CREATE INDEX IF NOT EXISTS idx_games_slot ON games(gym_slot_id);

-- ---------- Module D: change requests ----------
-- type 'reschedule': move game_id to the proposed court/date/time.
-- type 'swap':       exchange the court/date/time of game_id and swap_game_id.
-- status flow:
--   pending_director     (a coach asked; their own Program Director endorses)
--   pending_counterpart  (every other program involved must agree)
--   pending_admin        (System Admin gives league sign-off, then it's applied)
--   approved | denied | cancelled
CREATE TABLE IF NOT EXISTS change_requests (
  id                     TEXT PRIMARY KEY,
  game_id                TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL CHECK (type IN ('reschedule', 'swap')),
  swap_game_id           TEXT REFERENCES games(id) ON DELETE CASCADE,
  proposed_court_id      TEXT REFERENCES courts(id) ON DELETE SET NULL,
  proposed_date          TEXT,
  proposed_start_time    TEXT,
  proposed_end_time      TEXT,
  reason                 TEXT NOT NULL,
  snapshot               TEXT,          -- JSON: where the game(s) were when the request was filed
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
CREATE INDEX IF NOT EXISTS idx_requests_status ON change_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_game ON change_requests(game_id);
CREATE INDEX IF NOT EXISTS idx_requests_program ON change_requests(requesting_program_id);

-- One row per step: the requester's own director (stage 'director') and
-- each counterpart program (stage 'counterpart').
CREATE TABLE IF NOT EXISTS change_request_steps (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL CHECK (stage IN ('director', 'counterpart')),
  program_id   TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  decision     TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'denied')),
  decided_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TEXT,
  note         TEXT,
  UNIQUE (request_id, stage, program_id)
);
CREATE INDEX IF NOT EXISTS idx_steps_program ON change_request_steps(program_id, decision);
