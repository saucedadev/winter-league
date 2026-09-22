-- =====================================================================
-- Winter League Platform — Migration 006: final scores
--
-- A game's final score, entered after tip-off by a coach of either team,
-- either team's Program Director, or a System Admin. Scores are stored for
-- the home and away team as they are now; swapping home/away swaps them too.
-- Every entry or correction is recorded in Activity for both programs.
-- =====================================================================

ALTER TABLE games ADD COLUMN home_score INTEGER CHECK (home_score IS NULL OR home_score BETWEEN 0 AND 250);
ALTER TABLE games ADD COLUMN away_score INTEGER CHECK (away_score IS NULL OR away_score BETWEEN 0 AND 250);
ALTER TABLE games ADD COLUMN score_note TEXT;
ALTER TABLE games ADD COLUMN score_entered_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE games ADD COLUMN score_entered_at TEXT;
