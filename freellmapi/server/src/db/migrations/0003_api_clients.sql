-- Phase 3: per-org client API keys for the /v1 proxy. Multiple named, revocable
-- keys per org; only the SHA-256 hash is stored. The app (ensureDefaultClients
-- in db/index.ts) backfills one "Default" client per org from the existing
-- organizations.unified_key on boot, so existing keys keep working.
CREATE TABLE IF NOT EXISTS api_clients (
  id          serial PRIMARY KEY,
  org_id      integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'Default',
  key_prefix  text NOT NULL,
  key_hash    text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_clients_org  ON api_clients (org_id);
CREATE INDEX IF NOT EXISTS idx_api_clients_hash ON api_clients (key_hash);
