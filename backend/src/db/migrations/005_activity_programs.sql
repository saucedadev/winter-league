-- =====================================================================
-- Winter League Platform — Migration 005: activity involves programs
--
-- Before: each activity entry had one program_id, which for change
-- requests was only the program that asked, so the other program's
-- director never saw it, and the Activity screen showed that program's
-- code next to whoever acted (e.g. "Misty Sauceda · FGYB").
--
-- Now:
--   actor_program_id / actor_role: the acting person's own program and role
--     at the time, shown beside their name.
--   activity_log_programs: every program an entry involves. A director sees
--     an entry if their program is any of them.
-- activity_log.program_id stays as the entry's main program.
-- =====================================================================

ALTER TABLE activity_log ADD COLUMN actor_program_id TEXT REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE activity_log ADD COLUMN actor_role TEXT;

CREATE TABLE IF NOT EXISTS activity_log_programs (
  activity_id  TEXT NOT NULL REFERENCES activity_log(id) ON DELETE CASCADE,
  program_id   TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_programs_program ON activity_log_programs(program_id, activity_id);

-- Existing entries keep exactly the visibility they had (their one program).
INSERT OR IGNORE INTO activity_log_programs (activity_id, program_id)
  SELECT id, program_id FROM activity_log WHERE program_id IS NOT NULL;

-- Best available for older entries: the actor's current program and role.
UPDATE activity_log SET
  actor_program_id = (SELECT u.program_id FROM users u WHERE u.id = activity_log.actor_id),
  actor_role = (SELECT u.role FROM users u WHERE u.id = activity_log.actor_id)
WHERE actor_id IS NOT NULL;

-- Older change-request entries: whoever took a step on a request was involved
-- in it, so their program can see that entry too (e.g. a director's approval
-- on another program's request). Sign-offs by league staff stay with the
-- requesting program, since the old record doesn't list the other programs.
INSERT OR IGNORE INTO activity_log_programs (activity_id, program_id)
  SELECT id, actor_program_id FROM activity_log WHERE category = 'request' AND actor_program_id IS NOT NULL;
