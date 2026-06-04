-- Envelope encryption: per-org data-encryption key (DEK), wrapped by the master
-- KEK (env). Columns hold the wrapped DEK only — never plaintext, never the KEK.
-- The app (ensureOrgDeks + migrateLegacyProviderKeys in db/index.ts) backfills a
-- DEK per org on boot and re-encrypts existing provider keys KEK->DEK.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS dek_wrapped text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS dek_iv text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS dek_tag text;
