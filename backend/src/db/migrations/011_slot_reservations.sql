-- =====================================================================
-- Winter League Platform — Migration 011: day preferences (tagged gym slots)
--
-- A director can tag a game slot for Girls, Boys, or one division, e.g.
-- "our girls play on Mondays":
--   reserved_mode 'prefer' (the default): those games get the slot first;
--                 other games use it only if nothing else fits.
--   reserved_mode 'only':  only those games can use the slot.
-- Tags only apply to game slots (weeknight games and weekend blocks).
-- =====================================================================

ALTER TABLE gym_slots ADD COLUMN reserved_for TEXT CHECK (reserved_for IN ('girls', 'boys', 'division'));
ALTER TABLE gym_slots ADD COLUMN reserved_division_id TEXT REFERENCES divisions(id) ON DELETE SET NULL;
ALTER TABLE gym_slots ADD COLUMN reserved_mode TEXT CHECK (reserved_mode IN ('prefer', 'only'));
