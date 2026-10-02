-- =====================================================================
-- Winter League Platform — Migration 014: rule requests
--
-- A Program Director tells the league what their program needs from the
-- Matchmaker rules, in the app instead of by text or email:
--   kind 'travel_cap'    a lower travel cap for their program (requested_value: miles)
--        'rematch_limit' a different "most games against the same opponent"
--                        for one division (division_id; requested_value: 1–6 or 'none')
--        'league_rule'   a change to a league-wide rule (free text)
--        'other'         anything else, including things the matchmaker can't do yet
-- The System Admin answers: accepted (and, for the first two kinds, optionally
-- applied to the rules in one click: applied_value), declined, noted, or asks a
-- question (status 'question' until the director replies).
--
-- A request stays in effect until the program withdraws it or the league
-- declines it. confirmed_season_id records the season the league last
-- confirmed it for, so it can be re-confirmed each season.
-- =====================================================================

CREATE TABLE IF NOT EXISTS rule_requests (
  id                  TEXT PRIMARY KEY,
  program_id          TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  season_id           TEXT REFERENCES seasons(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('travel_cap', 'rematch_limit', 'league_rule', 'other')),
  division_id         TEXT REFERENCES divisions(id) ON DELETE SET NULL,
  requested_value     TEXT,
  details             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'question', 'accepted', 'declined', 'noted', 'withdrawn')),
  decision_note       TEXT,
  applied_value       TEXT,
  decided_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TEXT,
  confirmed_season_id TEXT REFERENCES seasons(id) ON DELETE SET NULL,
  requested_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rule_requests_program ON rule_requests(program_id, status);

-- Questions and replies on a request, oldest first.
CREATE TABLE IF NOT EXISTS rule_request_messages (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES rule_requests(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rule_request_messages ON rule_request_messages(request_id, created_at);
