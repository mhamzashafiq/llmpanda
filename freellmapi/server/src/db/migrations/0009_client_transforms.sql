-- Per-client-key request transforms: RTK token-saver + terse/caveman mode.
-- token_saver/terse_mode are 0/1 flags; terse_level is 'lite'|'full'|'ultra' (nullable).
ALTER TABLE api_clients ADD COLUMN IF NOT EXISTS token_saver integer NOT NULL DEFAULT 0;
ALTER TABLE api_clients ADD COLUMN IF NOT EXISTS terse_mode integer NOT NULL DEFAULT 0;
ALTER TABLE api_clients ADD COLUMN IF NOT EXISTS terse_level text;
