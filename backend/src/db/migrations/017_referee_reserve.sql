-- Referee payout reserve: a program can prepay the referee assignor, who then
-- pays that program's referees and draws the money from its reserve.

-- How a program pays its referees: 'direct' (its director pays them) or
-- 'reserve' (the assignor pays them from the program's reserve).
ALTER TABLE programs ADD COLUMN referee_pay_mode TEXT NOT NULL DEFAULT 'direct';
-- Email the program when "available" falls below this (cents); NULL = no alert.
ALTER TABLE programs ADD COLUMN reserve_alert_cents INTEGER;
-- 1 while the program is below its alert level, so it's emailed once per dip.
ALTER TABLE programs ADD COLUMN reserve_alerted INTEGER NOT NULL DEFAULT 0;

-- Referee payments: which were drawn from a reserve, in which season, and which
-- were made together (one Venmo payment covering several reserve programs).
ALTER TABLE referee_payments ADD COLUMN from_reserve INTEGER NOT NULL DEFAULT 0;
ALTER TABLE referee_payments ADD COLUMN season_id TEXT;
ALTER TABLE referee_payments ADD COLUMN batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_referee_payments_batch ON referee_payments(batch_id);

-- The reserve's money in and out, other than referee payouts (those are the
-- referee_payments rows with from_reserve = 1). Entries are never edited or
-- deleted once confirmed; a mistake is corrected with a reversing adjustment.
CREATE TABLE IF NOT EXISTS reserve_entries (
  id            TEXT PRIMARY KEY,
  program_id    TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  season_id     TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('deposit', 'refund', 'adjustment')),
  amount_cents  INTEGER NOT NULL,      -- deposits and refunds positive; adjustments + or -
  method        TEXT,                  -- check | cash | venmo | other
  entry_date    TEXT NOT NULL,         -- YYYY-MM-DD the money moved
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'declined')),
  reverses_id   TEXT REFERENCES reserve_entries(id) ON DELETE SET NULL,
  entered_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  entered_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TEXT,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_reserve_entries_program ON reserve_entries(program_id, season_id);
