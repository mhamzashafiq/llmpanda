-- Per-client-key model allow-list (the "Coding Agents" set). A JSON array of
-- model db ids this key may route to; NULL / empty = no restriction (the full
-- org fallback chain). Filtered in services/router.ts on top of the chain.
ALTER TABLE api_clients ADD COLUMN IF NOT EXISTS allowed_model_ids text;
