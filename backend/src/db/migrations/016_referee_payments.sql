-- Referee payments: how each referee wants to be paid, and a record of what
-- each program has paid them. No money moves through the app; programs pay
-- outside it (e.g. Venmo) and mark it here.

-- One row per method a referee accepts. Venmo is the only method offered for
-- now; others (Zelle, PayPal, Cash App) only need code, not a database change.
CREATE TABLE IF NOT EXISTS referee_payment_methods (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method      TEXT NOT NULL,              -- 'venmo'
  handle      TEXT NOT NULL,              -- e.g. the Venmo username, without @
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, method)
);

-- A payment a program made to a referee, marked as paid by a director (or by
-- the league on a program's behalf).
CREATE TABLE IF NOT EXISTS referee_payments (
  id            TEXT PRIMARY KEY,
  referee_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id    TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  method        TEXT NOT NULL,            -- how it was paid: venmo | check | cash | other
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_on       TEXT NOT NULL,            -- YYYY-MM-DD
  note          TEXT,
  recorded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at  TEXT                      -- the referee tapped "Got it"
);
CREATE INDEX IF NOT EXISTS idx_referee_payments_referee ON referee_payments(referee_id);
CREATE INDEX IF NOT EXISTS idx_referee_payments_program ON referee_payments(program_id);

-- Which games a payment covers, and how much of it went to each. The game is
-- copied in (date and teams) so the record still reads correctly later.
CREATE TABLE IF NOT EXISTS referee_payment_items (
  payment_id     TEXT NOT NULL REFERENCES referee_payments(id) ON DELETE CASCADE,
  assignment_id  TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  game_date      TEXT,
  game_label     TEXT,
  PRIMARY KEY (payment_id, assignment_id)
);
CREATE INDEX IF NOT EXISTS idx_referee_payment_items_assignment ON referee_payment_items(assignment_id);
