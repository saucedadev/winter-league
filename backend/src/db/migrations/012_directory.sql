-- =====================================================================
-- Winter League Platform — Migration 012: program Directory
--
-- A Program Director's own contact list (a Rolodex): people they need to
-- reach, with no app account. A contact can't sign in; creating accounts is
-- still the System Admin's job.
--
-- role: 'coach', 'referee', 'other' (with role_other as typed), or NULL.
-- A contact whose role is coach can be set as a team's head coach until a
-- real Coach account replaces them (teams.head_coach_contact_id). A team has
-- at most one of head_coach_user_id / head_coach_contact_id.
-- =====================================================================

CREATE TABLE IF NOT EXISTS directory_contacts (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  role        TEXT CHECK (role IN ('coach', 'referee', 'other')),
  role_other  TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_directory_program ON directory_contacts(program_id, last_name);

ALTER TABLE teams ADD COLUMN head_coach_contact_id TEXT REFERENCES directory_contacts(id) ON DELETE SET NULL;
