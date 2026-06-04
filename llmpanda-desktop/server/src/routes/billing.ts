import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from '../db/client.js';
import { requireOrg } from '../lib/tenant.js';
import { planLimits } from '../lib/plans.js';

// Phase 5: billing. The plan model + per-org quota gating (lib/plans.ts,
// services/quota.ts) are LIVE. The Stripe payment wiring (checkout, portal,
// webhook → flip `organizations.plan`) is scaffolded and env-gated: it activates
// only once STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / price ids are provided.
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function notConfigured(res: Response) {
  res.status(501).json({
    error: {
      message: 'Billing is not configured. Set STRIPE_SECRET_KEY (+ price ids) to enable upgrades.',
      type: 'not_configured',
    },
  });
}

export const billingRouter = Router();

// Current plan, status and this-month usage for the org.
billingRouter.get('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const [o] = await sql<{ plan: string; plan_status: string; stripe_customer_id: string | null }[]>`
    SELECT plan, plan_status, stripe_customer_id FROM organizations WHERE id = ${org}`;
  const [u] = await sql<{ used: number }[]>`
    SELECT COUNT(*)::int AS used FROM requests WHERE org_id = ${org} AND created_at >= date_trunc('month', now())`;
  const plan = o?.plan ?? 'free';
  res.json({
    plan,
    status: o?.plan_status ?? 'active',
    monthlyRequests: u?.used ?? 0,
    monthlyRequestLimit: planLimits(plan).monthlyRequests,
    billingConfigured: Boolean(STRIPE_SECRET),
  });
});

// Start a Stripe Checkout session for an upgrade. Env-gated scaffold.
billingRouter.post('/checkout', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  if (!STRIPE_SECRET) return notConfigured(res);
  // With the Stripe SDK + STRIPE_PRICE_* ids: create a Checkout Session bound to
  // the org's stripe_customer_id (create the customer if absent) and return
  // session.url. Left unimplemented until keys are provided.
  res.status(501).json({ error: { message: 'Stripe checkout not wired yet — add the Stripe SDK + price ids.', type: 'not_implemented' } });
});

// Open the Stripe billing portal. Env-gated scaffold.
billingRouter.get('/portal', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  if (!STRIPE_SECRET) return notConfigured(res);
  res.status(501).json({ error: { message: 'Stripe billing portal not wired yet.', type: 'not_implemented' } });
});

// Stripe webhook (raw body mounted in app.ts, no session auth). Env-gated.
export const stripeWebhookRouter = Router();
stripeWebhookRouter.post('/', async (_req: Request, res: Response) => {
  if (!STRIPE_WEBHOOK_SECRET) {
    res.status(501).json({ error: { message: 'Webhook not configured (set STRIPE_WEBHOOK_SECRET).' } });
    return;
  }
  // With the Stripe SDK: verify the signature against the raw body, dedupe on the
  // event id via billing_events, then on checkout.session.completed /
  // customer.subscription.updated|deleted set organizations.plan + plan_status.
  // Unimplemented until keys are provided.
  res.status(501).json({ error: { message: 'Stripe webhook handler not wired yet.' } });
});
