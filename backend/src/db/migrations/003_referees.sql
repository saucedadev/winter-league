-- =====================================================================
-- Winter League Platform — Migration 003: Phase 3 Referees
--
-- Module C: referee assignment, mobile check-in, and payout export.
-- Real payment (ACH / Stripe Connect) is intentionally out of scope; the
-- deliverable is a CSV the league pays from in its own system.
--
-- League-wide referee settings live in app_settings under key
-- 'referee_settings' (JSON): referees per game, default pay, check-in window.
-- =====================================================================

-- Per-referee details. pay_rate_cents NULL = use the league default.
CREATE TABLE IF NOT EXISTS referee_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pay_rate_cents  INTEGER CHECK (pay_rate_cents IS NULL OR pay_rate_cents >= 0),
  notes           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dates a referee can't work. The assignor sees these when assigning.
CREATE TABLE IF NOT EXISTS referee_unavailability (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS idx_ref_unavail_user ON referee_unavailability(user_id, start_date);

-- One row per referee position on a published game (position 1, 2, ...).
-- referee_id NULL = open slot. Rows are created for every scheduled game
-- when a schedule is published (and topped up whenever games are placed).
--
-- status:  assigned   -> referee is on the game
--          checked_in -> referee checked in (or the assignor confirmed they worked): payable
--          no_show    -> assignor marked them absent: not payable
CREATE TABLE IF NOT EXISTS referee_assignments (
  id                       TEXT PRIMARY KEY,
  game_id                  TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  position                 INTEGER NOT NULL CHECK (position >= 1),
  referee_id               TEXT REFERENCES users(id) ON DELETE SET NULL,
  status                   TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'checked_in', 'no_show')),
  assigned_by              TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at              TEXT,
  checked_in_at            TEXT,
  check_in_method          TEXT CHECK (check_in_method IS NULL OR check_in_method IN ('referee', 'assignor')),
  check_in_distance_miles  REAL,       -- from the venue, when the phone shared its location
  pay_cents                INTEGER,    -- rate locked in at check-in, so later rate changes don't rewrite what's owed
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, position)
);
CREATE INDEX IF NOT EXISTS idx_assign_referee ON referee_assignments(referee_id);
CREATE INDEX IF NOT EXISTS idx_assign_game ON referee_assignments(game_id);
