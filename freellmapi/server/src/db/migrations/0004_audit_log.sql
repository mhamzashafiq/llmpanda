-- Phase 7: append-only audit trail of security-relevant actions.
CREATE TABLE IF NOT EXISTS audit_log (
  id          serial PRIMARY KEY,
  org_id      integer,
  user_id     integer,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  meta        jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log (org_id, created_at);
