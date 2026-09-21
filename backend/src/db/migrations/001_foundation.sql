-- =====================================================================
-- Winter League Platform — Migration 001: Phase 1 Foundation
--
-- This database is completely separate from Gym Hive's. No table here
-- references, mirrors, or shares rows with Gym Hive (feasibility report,
-- Section 5, Option B: fully separate accounts).
--
-- Conventions: TEXT uuid primary keys, dates as 'YYYY-MM-DD', times as
-- 'HH:MM' (24h), timestamps as SQLite datetime('now') UTC strings.
-- =====================================================================

-- ---------- Sitewide settings (theme, etc.) ----------
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------- Programs (the up-to-16 member organizations) ----------
CREATE TABLE IF NOT EXISTS programs (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  short_code     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  city           TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Users (Winter League accounts only) ----------
-- Roles are namespaced deliberately: "league_coach" (read-only schedule +
-- change requests) is NOT Gym Hive's coach (requests gym time).
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email                 TEXT NOT NULL COLLATE NOCASE,
  phone                 TEXT,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN (
                          'super_admin', 'program_director', 'league_coach',
                          'referee_assignor', 'referee')),
  program_id            TEXT REFERENCES programs(id) ON DELETE SET NULL,
  is_active             INTEGER NOT NULL DEFAULT 1,
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  last_login_at         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_program ON users(program_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Seasons ----------
-- Exactly one season is active at a time; gym slots must fall inside it.
CREATE TABLE IF NOT EXISTS seasons (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (start_date < end_date)
);

-- ---------- Divisions (league-wide, managed by the System Admin) ----------
CREATE TABLE IF NOT EXISTS divisions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  grade       TEXT,
  gender      TEXT NOT NULL DEFAULT 'boys' CHECK (gender IN ('boys', 'girls', 'coed')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Venues + courts (Gym Hive's gyms + gym_spaces, per program) ----------
-- latitude/longitude are optional now; Phase 2's matchmaker uses them for
-- the travel-distance constraint.
CREATE TABLE IF NOT EXISTS venues (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  latitude    REAL,
  longitude   REAL,
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program_id, name)
);
CREATE INDEX IF NOT EXISTS idx_venues_program ON venues(program_id);

CREATE TABLE IF NOT EXISTS courts (
  id          TEXT PRIMARY KEY,
  venue_id    TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (venue_id, name)
);

-- ---------- Teams ----------
CREATE TABLE IF NOT EXISTS teams (
  id                   TEXT PRIMARY KEY,
  program_id           TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  division_id          TEXT NOT NULL REFERENCES divisions(id),
  name                 TEXT NOT NULL,
  head_coach_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program_id, division_id, name)
);
CREATE INDEX IF NOT EXISTS idx_teams_program ON teams(program_id);
CREATE INDEX IF NOT EXISTS idx_teams_division ON teams(division_id);

-- ---------- Module A: gym slots ----------
CREATE TABLE IF NOT EXISTS gym_slots (
  id           TEXT PRIMARY KEY,
  program_id   TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  season_id    TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  court_id     TEXT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('PRACTICE', 'WEEKNIGHT_GAME', 'WEEKEND_GAME_BLOCK')),
  notes        TEXT,
  series_id    TEXT,               -- shared by slots created together as a weekly repeat
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_slots_court_date ON gym_slots(court_id, date);
CREATE INDEX IF NOT EXISTS idx_slots_program_date ON gym_slots(program_id, date);
CREATE INDEX IF NOT EXISTS idx_slots_series ON gym_slots(series_id);

-- ---------- Module A: blackout dates ----------
-- venue_id NULL = applies to every venue in the program.
-- Blackouts layer over slots; they never delete them.
CREATE TABLE IF NOT EXISTS blackout_dates (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  venue_id    TEXT REFERENCES venues(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS idx_blackouts_program ON blackout_dates(program_id, start_date);

-- ---------- Activity log ----------
CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor_id    TEXT,
  actor_name  TEXT,
  program_id  TEXT,
  details     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
