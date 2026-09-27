-- =====================================================================
-- Winter League Platform — Migration 009: guest (non-conference) teams
--
-- A guest program is an outside club the league plays now and then, e.g.
-- "Sherwood Youth Basketball". It's an ordinary program with teams, so every
-- game feature (courts, referees, check-in, scores, payouts, Activity) works
-- for guest games unchanged. What's different is enforced in the app:
--   • the matchmaker never schedules guests; guest games are added by hand;
--   • guests don't count toward the program limit, have no directors,
--     coaches, venues, gym slots or blackouts, and never host;
--   • requests on guest games skip the "other program agrees" step;
--   • guest games don't count toward a team's games-per-team target or
--     home/away balance, and are marked Guest wherever games are shown.
-- =====================================================================

ALTER TABLE programs ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_programs_guest ON programs(is_guest);
