-- Email verification (login gated until verified) + password reset.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified integer NOT NULL DEFAULT 0;
-- Grandfather every EXISTING account as verified — only new signups must verify.
UPDATE users SET email_verified = 1;

-- Single-use, expiring tokens for 'verify' and 'reset' flows. Only the SHA-256
-- hash is stored; the raw token rides the emailed link.
CREATE TABLE IF NOT EXISTS email_tokens (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,            -- 'verify' | 'reset'
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_hash ON email_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens (user_id);
