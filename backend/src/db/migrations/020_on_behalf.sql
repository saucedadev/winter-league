-- League admin helping a program: when the System Admin changes a program's
-- own records (teams, venues, gym slots, blackouts, directory, rule requests,
-- preseason, draft review flags), the entry records which program it was done
-- for. The program's director sees these entries, and a dashboard card counts
-- the recent ones.
ALTER TABLE activity_log ADD COLUMN on_behalf_program_id TEXT REFERENCES programs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_activity_on_behalf ON activity_log(on_behalf_program_id, created_at);
