-- =====================================================================
-- Winter League Platform — Migration 010: draft sharing and director sign-off
--
-- 1. The System Admin SHARES a draft with Program Directors (optionally with
--    a review deadline). Directors see their own program's games read-only.
-- 2. Each program's director SIGNS OFF, or FLAGS specific games with a note.
--    A program without a director can be signed off by the System Admin on
--    its behalf (recorded as such).
-- 3. When the admin changes a game after a program has reviewed, only the
--    programs in that game have to review again.
-- 4. Publishing needs every program with teams to have signed off. After the
--    deadline has passed the admin may publish anyway; that override (who,
--    when, which programs hadn't signed off, and why) is recorded.
-- =====================================================================

ALTER TABLE schedule_runs ADD COLUMN shared_at TEXT;
ALTER TABLE schedule_runs ADD COLUMN shared_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE schedule_runs ADD COLUMN review_deadline TEXT;   -- YYYY-MM-DD, end of that day in league time
ALTER TABLE schedule_runs ADD COLUMN publish_override TEXT;  -- JSON, when published without every sign-off

-- One row per program with teams in a shared draft.
CREATE TABLE IF NOT EXISTS draft_reviews (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES schedule_runs(id) ON DELETE CASCADE,
  program_id    TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'signed_off', 'flagged')),
  decided_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TEXT,
  on_behalf     INTEGER NOT NULL DEFAULT 0,   -- the System Admin signed off for a program without a director
  note          TEXT,
  reset_reason  TEXT,                         -- why a program has to review again (a game changed)
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (run_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_draft_reviews_run ON draft_reviews(run_id);

-- A director's flag on one draft game ("11/5 clashes with our school event").
CREATE TABLE IF NOT EXISTS draft_flags (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES schedule_runs(id) ON DELETE CASCADE,
  program_id      TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  game_id         TEXT REFERENCES games(id) ON DELETE SET NULL,
  game_label      TEXT NOT NULL,              -- the game as it was when flagged, in case it's removed later
  note            TEXT NOT NULL,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_draft_flags_run ON draft_flags(run_id, program_id);
