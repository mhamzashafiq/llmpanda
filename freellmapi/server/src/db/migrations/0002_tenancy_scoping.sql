-- Phase 2: tenant isolation (app-layer org_id scoping, no RLS).
-- Backfills org_id on every tenant table, gives each org its own unified API key,
-- and makes fallback_config per-org. Idempotent: safe to re-run.

-- ── Per-org unified key ──────────────────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS unified_key text;

-- The original single-tenant key (settings.unified_api_key) belongs to the
-- operator = the lowest org id, so their existing key keeps working.
UPDATE organizations o
SET unified_key = (SELECT value FROM settings WHERE key = 'unified_api_key')
WHERE o.id = (SELECT MIN(id) FROM organizations)
  AND o.unified_key IS NULL
  AND EXISTS (SELECT 1 FROM settings WHERE key = 'unified_api_key');

-- Any remaining org without a key is backfilled by the app on boot
-- (ensureOrgUnifiedKeys in db/index.ts) using crypto.randomBytes.
ALTER TABLE organizations ADD CONSTRAINT organizations_unified_key_key UNIQUE (unified_key);

-- ── Backfill api_keys → operator org ─────────────────────────────────────────
UPDATE api_keys SET org_id = (SELECT MIN(id) FROM organizations) WHERE org_id IS NULL;

-- ── fallback_config: make it per-org ─────────────────────────────────────────
-- Existing seeded rows have org_id IS NULL and become the shared TEMPLATE that
-- new orgs are cloned from. Routing/dashboard queries always filter by org_id,
-- so template rows are never served.
DROP INDEX IF EXISTS fallback_config_model_db_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS fallback_config_org_model_key
  ON fallback_config (org_id, model_db_id);

-- Clone the template into every existing org.
INSERT INTO fallback_config (org_id, model_db_id, priority, enabled)
SELECT o.id, fc.model_db_id, fc.priority, fc.enabled
FROM organizations o
CROSS JOIN fallback_config fc
WHERE fc.org_id IS NULL
ON CONFLICT (org_id, model_db_id) DO NOTHING;

-- ── Backfill the ledger + request log from the owning key ────────────────────
UPDATE requests r SET org_id = k.org_id
  FROM api_keys k WHERE r.key_id = k.id AND r.org_id IS NULL;
UPDATE requests SET org_id = (SELECT MIN(id) FROM organizations) WHERE org_id IS NULL;

UPDATE rate_limit_usage u SET org_id = k.org_id
  FROM api_keys k WHERE u.key_id = k.id AND u.org_id IS NULL;
UPDATE rate_limit_usage SET org_id = (SELECT MIN(id) FROM organizations) WHERE org_id IS NULL;

UPDATE rate_limit_cooldowns c SET org_id = k.org_id
  FROM api_keys k WHERE c.key_id = k.id AND c.org_id IS NULL;
UPDATE rate_limit_cooldowns SET org_id = (SELECT MIN(id) FROM organizations) WHERE org_id IS NULL;

-- ── Enforce NOT NULL on the fully-backfilled tenant tables ───────────────────
-- (fallback_config stays nullable: the NULL rows are the shared template.)
ALTER TABLE api_keys             ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE requests             ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE rate_limit_usage     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE rate_limit_cooldowns ALTER COLUMN org_id SET NOT NULL;

-- Helpful scoping indexes.
CREATE INDEX IF NOT EXISTS idx_api_keys_org           ON api_keys (org_id);
CREATE INDEX IF NOT EXISTS idx_requests_org_created   ON requests (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fallback_config_org    ON fallback_config (org_id);
