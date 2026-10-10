-- Hub Portal single sign-on.
-- Each sign-in pass from the portal works once: its ID (jti) is recorded here
-- and a second use is refused. Rows are cleared once the pass has expired.
CREATE TABLE IF NOT EXISTS sso_used_passes (
  jti         TEXT PRIMARY KEY,
  expires_at  TEXT NOT NULL
);
