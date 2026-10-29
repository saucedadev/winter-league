-- Preseason: an optional window before the regular season when programs that
-- are ready can arrange scrimmages and joint practices with each other.

-- The day the preseason opens (NULL = no preseason). The regular season still
-- starts on start_date; gym slots are accepted from preseason_start, and the
-- Matchmaker only uses gym time from start_date.
ALTER TABLE seasons ADD COLUMN preseason_start TEXT;

-- Teams ready for preseason play (a director flips this per team).
ALTER TABLE teams ADD COLUMN preseason_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN preseason_open_at TEXT;

-- Scrimmages and joint practices. Kept apart from league games: they don't
-- count toward games per team, home/away balance or standings, and the
-- Matchmaker never touches them. The host is the team whose gym it's in.
CREATE TABLE IF NOT EXISTS preseason_events (
  id                    TEXT PRIMARY KEY,
  season_id             TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('scrimmage', 'joint_practice')),
  host_team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  visitor_team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  requesting_team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  court_id              TEXT REFERENCES courts(id) ON DELETE SET NULL,
  gym_slot_id           TEXT REFERENCES gym_slots(id) ON DELETE SET NULL,
  date                  TEXT NOT NULL,
  start_time            TEXT NOT NULL,
  end_time              TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'declined', 'withdrawn', 'cancelled')),
  referees_wanted       INTEGER NOT NULL DEFAULT 0,
  note                  TEXT,
  requested_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at          TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at            TEXT,
  decision_note         TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (host_team_id != visitor_team_id)
);
CREATE INDEX IF NOT EXISTS idx_preseason_events_season ON preseason_events(season_id, date);
CREATE INDEX IF NOT EXISTS idx_preseason_events_court ON preseason_events(court_id, date);
