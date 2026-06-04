// Phase 4/5: per-org plan entitlements. monthlyRequests = null means unlimited.
// Stripe (Phase 5) flips an org's `plan` column; these caps gate the proxy.
export type Plan = 'free' | 'pro' | 'enterprise';

export interface PlanLimits {
  monthlyRequests: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { monthlyRequests: 10_000 },
  pro: { monthlyRequests: 1_000_000 },
  enterprise: { monthlyRequests: null },
};

export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[(plan as Plan)] ?? PLAN_LIMITS.free;
}
