import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  userCount,
  createUser,
  verifyCredentials,
  createSession,
  validateSession,
  deleteSession,
  createEmailToken,
  consumeEmailToken,
  createResetOtp,
  checkResetOtp,
  consumeResetOtp,
  markEmailVerified,
  setPassword,
  findUserByEmail,
  findOrCreateOAuthUser,
} from '../services/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail, APP_URL } from '../services/email.js';
import { sql } from '../db/client.js';
import crypto from 'crypto';

export const authRouter = Router();

// Dashboard auth (#35). These routes are mounted BEFORE requireAuth, so
// /status, /setup and /login are reachable without a session (bootstrap);
// /logout and /me validate the token themselves.

const credentialsSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Registration captures lead-generation fields alongside credentials.
const registerSchema = credentialsSchema.extend({
  fullName: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  role: z.string().trim().max(80).optional(),
  teamSize: z.string().trim().max(40).optional(),
  useCase: z.string().trim().max(1000).optional(),
  source: z.string().trim().max(80).optional(),
  marketingOptIn: z.boolean().optional(),
});

type RegisterInput = z.infer<typeof registerSchema>;

// Best-effort lead capture — never fail signup if this insert fails.
async function captureLead(userId: number, orgId: number | null, d: RegisterInput): Promise<void> {
  try {
    await sql`
      INSERT INTO leads (user_id, org_id, email, full_name, company, role, team_size, use_case, source, marketing_opt_in)
      VALUES (${userId}, ${orgId}, ${d.email.trim().toLowerCase()}, ${d.fullName ?? null}, ${d.company ?? null},
              ${d.role ?? null}, ${d.teamSize ?? null}, ${d.useCase ?? null}, ${d.source ?? null}, ${d.marketingOptIn ? 1 : 0})`;
  } catch (e) {
    console.error('[auth] lead capture failed:', e);
  }
}

// ── Brute-force throttle ──────────────────────────────────────────────────
// Simple in-memory per-email limiter. A local single-user tool doesn't need a
// distributed store; this just blunts online password guessing.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

function isLockedOut(email: string): boolean {
  const a = attempts.get(email.toLowerCase());
  return !!a && a.lockedUntil > Date.now();
}
function recordFailure(email: string): void {
  const key = email.toLowerCase();
  const a = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  a.count++;
  if (a.count >= MAX_ATTEMPTS) {
    a.lockedUntil = Date.now() + LOCKOUT_MS;
    a.count = 0;
  }
  attempts.set(key, a);
}
function clearFailures(email: string): void {
  attempts.delete(email.toLowerCase());
}

function bearer(req: Request): string | undefined {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);
}

// Has the dashboard been set up yet, and is this caller authenticated?
authRouter.get('/status', async (req: Request, res: Response) => {
  const session = await validateSession(bearer(req));
  res.json({
    needsSetup: (await userCount()) === 0,
    authenticated: !!session,
    email: session?.email ?? null,
  });
});

// First-run account creation. Only allowed while there are zero users, so it
// can't be used to add accounts once the dashboard is claimed.
authRouter.post('/setup', async (req: Request, res: Response) => {
  if ((await userCount()) > 0) {
    res.status(409).json({ error: { message: 'Setup already completed. Use login instead.', type: 'setup_complete' } });
    return;
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const d = parsed.data;
  // First-run operator is auto-verified so they're never locked out by email.
  const user = await createUser(d.email, d.password, { fullName: d.fullName, orgName: d.company });
  await captureLead(user.userId, user.orgId, d);
  await markEmailVerified(user.userId);
  const token = await createSession(user.userId);
  res.status(201).json({ token, email: user.email });
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const { email, password } = parsed.data;

  if (isLockedOut(email)) {
    res.status(429).json({ error: { message: 'Too many failed attempts. Try again later.', type: 'rate_limit_error' } });
    return;
  }

  const result = await verifyCredentials(email, password);
  if (!result.ok) {
    if (result.reason === 'unverified') {
      res.status(403).json({ error: { message: 'Verify your email before signing in. Check your inbox or request a new link.', type: 'authentication_error', code: 'email_unverified' } });
      return;
    }
    recordFailure(email);
    // Same message whether the email exists or not — don't leak which.
    res.status(401).json({ error: { message: 'Invalid email or password', type: 'authentication_error' } });
    return;
  }

  clearFailures(email);
  const token = await createSession(result.user.userId);
  res.json({ token, email: result.user.email });
});

// Open registration — creates an additional account (unlike /setup, which is
// first-run only). Returns 409 if the email is already taken.
authRouter.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const d = parsed.data;
  try {
    const user = await createUser(d.email, d.password, { fullName: d.fullName, orgName: d.company });
    await captureLead(user.userId, user.orgId, d);
    // Email verification gates login — send the link, do NOT auto-login.
    const token = await createEmailToken(user.userId, 'verify');
    await sendVerificationEmail(user.email, token);
    res.status(201).json({ needsVerification: true, email: user.email });
  } catch (err: any) {
    if (err?.code === 'email_taken') {
      res.status(409).json({ error: { message: 'An account with that email already exists.', type: 'email_taken' } });
      return;
    }
    throw err;
  }
});

// ── Email verification ────────────────────────────────────────────────────
const tokenSchema = z.object({ token: z.string().min(1) });
const emailSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6,8}$/, 'Enter the 6-digit code from your email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

authRouter.post('/verify', async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Token required' } }); return; }
  const userId = await consumeEmailToken(parsed.data.token, 'verify');
  if (!userId) { res.status(400).json({ error: { message: 'Invalid or expired verification link.', code: 'invalid_token' } }); return; }
  await markEmailVerified(userId);
  res.json({ success: true });
});

authRouter.post('/resend-verification', async (req: Request, res: Response) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Valid email required' } }); return; }
  const user = await findUserByEmail(parsed.data.email);
  if (user && !user.emailVerified) {
    await sendVerificationEmail(parsed.data.email, await createEmailToken(user.id, 'verify'));
  }
  res.json({ success: true }); // always 200 — no account enumeration
});

// ── Password reset ────────────────────────────────────────────────────────
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Valid email required' } }); return; }
  const user = await findUserByEmail(parsed.data.email);
  if (user) {
    await sendPasswordResetEmail(parsed.data.email, await createResetOtp(user.id));
  }
  res.json({ success: true }); // always 200 — no account enumeration
});

// Live (non-consuming) check used by the reset form as the user types the code.
authRouter.post('/verify-reset-code', async (req: Request, res: Response) => {
  const parsed = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6,8}$/) }).safeParse(req.body);
  if (!parsed.success) { res.json({ valid: false }); return; }
  res.json({ valid: await checkResetOtp(parsed.data.email, parsed.data.code) });
});

authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } }); return; }
  const userId = await consumeResetOtp(parsed.data.email, parsed.data.code);
  if (!userId) { res.status(400).json({ error: { message: 'Invalid or expired code. Request a new one.', code: 'invalid_code' } }); return; }
  await setPassword(userId, parsed.data.password);
  res.json({ success: true });
});

// ── GitHub OAuth ───────────────────────────────────────────────────────────
const GH_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GH_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GH_CALLBACK = `${APP_URL}/api/auth/github/callback`;

// Short-lived CSRF states (single instance; pg-boss-style sharing not needed for
// a 10-minute login handshake). Pruned lazily.
const ghStates = new Map<string, number>();
function issueState(): string {
  const s = crypto.randomBytes(16).toString('hex');
  ghStates.set(s, Date.now() + 10 * 60 * 1000);
  return s;
}
function consumeState(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const exp = ghStates.get(s);
  ghStates.delete(s);
  if (ghStates.size > 500) { const now = Date.now(); for (const [k, v] of ghStates) if (v < now) ghStates.delete(k); }
  return !!exp && exp > Date.now();
}

// Kick off the OAuth dance: redirect the browser to GitHub's consent screen.
authRouter.get('/github', (_req: Request, res: Response) => {
  if (!GH_CLIENT_ID || !GH_CLIENT_SECRET) { res.redirect(`${APP_URL}/login?oauth_error=unconfigured`); return; }
  const state = issueState();
  const url = `https://github.com/login/oauth/authorize?client_id=${GH_CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(GH_CALLBACK)}`
    + `&scope=${encodeURIComponent('read:user user:email')}&state=${state}`;
  res.redirect(url);
});

// GitHub redirects back here with ?code&state. Exchange the code, resolve the
// verified email, find-or-create the user, mint a session, then hand the token
// to the SPA via the /oauth landing route.
authRouter.get('/github/callback', async (req: Request, res: Response) => {
  try {
    if (!GH_CLIENT_ID || !GH_CLIENT_SECRET) { res.redirect(`${APP_URL}/login?oauth_error=unconfigured`); return; }
    const { code, state } = req.query;
    if (!code || !consumeState(state)) { res.redirect(`${APP_URL}/login?oauth_error=state`); return; }

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GH_CLIENT_ID, client_secret: GH_CLIENT_SECRET, code, redirect_uri: GH_CALLBACK }),
    });
    const accessToken = (await tokenRes.json() as { access_token?: string }).access_token;
    if (!accessToken) { res.redirect(`${APP_URL}/login?oauth_error=token`); return; }

    const gh = { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'LLM-Panda', Accept: 'application/vnd.github+json' };
    const ghUser = await (await fetch('https://api.github.com/user', { headers: gh })).json() as { email?: string; name?: string; login?: string };
    let email = ghUser.email;
    if (!email) {
      const emails = await (await fetch('https://api.github.com/user/emails', { headers: gh })).json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const pick = Array.isArray(emails) ? (emails.find(e => e.primary && e.verified) ?? emails.find(e => e.verified)) : undefined;
      email = pick?.email;
    }
    if (!email) { res.redirect(`${APP_URL}/login?oauth_error=email`); return; }

    const { user, isNew } = await findOrCreateOAuthUser(email, ghUser.name ?? ghUser.login);
    const token = await createSession(user.userId);
    // New OAuth signups land on the onboarding/lead page first; returning users
    // (incl. email accounts logging in via GitHub) go straight to the dashboard.
    res.redirect(`${APP_URL}/oauth#token=${token}${isNew ? '&new=1' : ''}`);
  } catch {
    res.redirect(`${APP_URL}/login?oauth_error=failed`);
  }
});

// Onboarding lead capture for OAuth signups (no lead row was collected at the
// GitHub consent screen). Authenticated by the session minted during callback.
const onboardingSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  role: z.string().trim().max(80).optional(),
  teamSize: z.string().trim().max(40).optional(),
  useCase: z.string().trim().max(1000).optional(),
  marketingOptIn: z.boolean().optional(),
});
authRouter.post('/onboarding', async (req: Request, res: Response) => {
  const session = await validateSession(bearer(req));
  if (!session) { res.status(401).json({ error: { message: 'Authentication required' } }); return; }
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Invalid input' } }); return; }
  const d = parsed.data;
  if (d.fullName) await sql`UPDATE users SET full_name = ${d.fullName} WHERE id = ${session.userId}`;
  try {
    await sql`
      INSERT INTO leads (user_id, org_id, email, full_name, company, role, team_size, use_case, source, marketing_opt_in)
      VALUES (${session.userId}, ${session.orgId}, ${session.email}, ${d.fullName ?? null}, ${d.company ?? null},
              ${d.role ?? null}, ${d.teamSize ?? null}, ${d.useCase ?? null}, 'github_oauth', ${d.marketingOptIn ? 1 : 0})`;
  } catch (e) {
    console.error('[auth] onboarding lead capture failed:', e);
  }
  res.json({ success: true });
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  await deleteSession(bearer(req));
  res.json({ success: true });
});

authRouter.get('/me', async (req: Request, res: Response) => {
  const session = await validateSession(bearer(req));
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  res.json({ email: session.email });
});
