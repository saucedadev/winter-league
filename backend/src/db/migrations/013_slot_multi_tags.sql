-- =====================================================================
-- Winter League Platform — Migration 013: keep a slot for any mix of divisions
--
-- Migration 011 let a game slot be kept for Girls, Boys, or ONE division.
-- Now it can be kept for any set of divisions, e.g. 4th–6th Grade Boys and
-- Girls: reserved_divisions holds a JSON array of division ids. reserved_mode
-- ('prefer' / 'only') is unchanged.
--
-- Existing tags are converted: Girls -> every girls' division, Boys -> every
-- boys' division, one division -> that division. The old columns are cleared
-- (SQLite can't easily drop them) and no longer used.
-- =====================================================================

ALTER TABLE gym_slots ADD COLUMN reserved_divisions TEXT;

UPDATE gym_slots SET reserved_divisions = (SELECT json_group_array(id) FROM divisions WHERE gender = 'girls' AND is_active = 1)
  WHERE reserved_for = 'girls';
UPDATE gym_slots SET reserved_divisions = (SELECT json_group_array(id) FROM divisions WHERE gender = 'boys' AND is_active = 1)
  WHERE reserved_for = 'boys';
UPDATE gym_slots SET reserved_divisions = json_array(reserved_division_id)
  WHERE reserved_for = 'division' AND reserved_division_id IS NOT NULL;
-- A tag that converted to nothing (e.g. no girls' divisions) is dropped.
UPDATE gym_slots SET reserved_divisions = NULL, reserved_mode = NULL
  WHERE reserved_for IS NOT NULL AND (reserved_divisions IS NULL OR reserved_divisions = '[]');
UPDATE gym_slots SET reserved_for = NULL, reserved_division_id = NULL;
