-- Phase 4 (plan/quota) + Phase 5 (billing scaffold).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'active';

-- Stripe webhook idempotency + audit (id = Stripe event id).
CREATE TABLE IF NOT EXISTS billing_events (
  id         text PRIMARY KEY,
  org_id     integer REFERENCES organizations(id) ON DELETE SET NULL,
  type       text NOT NULL,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
