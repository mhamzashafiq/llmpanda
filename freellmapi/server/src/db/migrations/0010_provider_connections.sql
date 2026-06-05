-- P4: OAuth-based provider connections (Kiro / Copilot / Cursor / Qoder).
-- Token bundle stored ENCRYPTED under the org DEK. Opt-in; enabled=0 by default.
CREATE TABLE IF NOT EXISTS provider_connections (
  id          serial PRIMARY KEY,
  org_id      integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  auth_type   text NOT NULL,
  email       text,
  label       text,
  secret_enc  text NOT NULL,
  secret_iv   text NOT NULL,
  secret_tag  text NOT NULL,
  expires_at  timestamptz,
  enabled     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_connections_org ON provider_connections (org_id);
