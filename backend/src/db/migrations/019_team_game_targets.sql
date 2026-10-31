-- Team games override: a program can ask for fewer league games for one of
-- its teams (a travel team that mostly plays tournaments, say). NULL = the
-- league's games per team. Lower than the league's only; 0 = no league games.
-- The Matchmaker reads these when it builds a draft, and each draft keeps a
-- copy so later changes show as "changed since this draft".
ALTER TABLE teams ADD COLUMN games_target INTEGER;
ALTER TABLE teams ADD COLUMN games_target_reason TEXT;
ALTER TABLE teams ADD COLUMN games_target_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE teams ADD COLUMN games_target_at TEXT;
