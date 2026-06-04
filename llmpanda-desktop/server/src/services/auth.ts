import crypto from 'crypto';
import { sql } from '../db/client.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

// Dashboard authentication: email + password accounts with opaque session
// tokens. Each account owns an organization (Phase 2 tenancy); the active org
// is resolved from the user's membership.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  userId: number;
  email: string;
  orgId: number | null;
}

export interface CreateUserOpts {
  fullName?: string;
  orgName?: string;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function userCount(): Promise<number> {
  const [row] = await sql<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM users`;
  return row.c;
}

/**
 * Create a user + their organization + an owner membership (one transaction).
 * Throws { code: 'email_taken' } if the email already exists.
 */
export async function createUser(email: string, password: string, opts: CreateUserOpts = {}): Promise<SessionUser> {
  const normalized = normalizeEmail(email);
  const existing = await sql`SELECT id FROM users WHERE email = ${normalized}`;
  if (existing[0]) {
    const err = new Error('An account with that email already exists') as any;
    err.code = 'email_taken';
    throw err;
  }

  const orgName = opts.orgName?.trim()
    || (opts.fullName?.trim() ? `${opts.fullName.trim()}'s workspace` : `${normalized}'s workspace`);

  const unifiedKey = `llmpanda-${crypto.randomBytes(24).toString('hex')}`;

  return await sql.begin(async tx => {
    const [u] = await tx<{ id: number }[]>`
      INSERT INTO users (email, password_hash, full_name)
      VALUES (${normalized}, ${hashPassword(password)}, ${opts.fullName ?? null})
      RETURNING id`;
    const [o] = await tx<{ id: number }[]>`
      INSERT INTO organizations (name, owner_user_id, unified_key)
      VALUES (${orgName}, ${u.id}, ${unifiedKey}) RETURNING id`;
    await tx`INSERT INTO memberships (org_id, user_id, role) VALUES (${o.id}, ${u.id}, 'owner')`;
    // Clone the shared fallback-chain template (org_id IS NULL) into this org so
    // it starts with the full default routing chain, isolated from other tenants.
    await tx`
      INSERT INTO fallback_config (org_id, model_db_id, priority, enabled)
      SELECT ${o.id}, model_db_id, priority, enabled FROM fallback_config WHERE org_id IS NULL
      ON CONFLICT (org_id, model_db_id) DO NOTHING`;
    return { userId: u.id, email: normalized, orgId: o.id };
  });
}

/**
 * Lazily provision an org for a user that has none — legacy accounts created
 * before the org backbone, or any future orphan. Mirrors createUser's org setup
 * (org + owner membership + unified key + fallback template + default client) so
 * the user lands in a fully-formed, isolated tenant. Returns the new org id.
 */
export async function provisionOrgForUser(userId: number, email: string): Promise<number> {
  const unifiedKey = `llmpanda-${crypto.randomBytes(24).toString('hex')}`;
  const name = `${normalizeEmail(email)}'s workspace`;
  return await sql.begin(async tx => {
    const [o] = await tx<{ id: number }[]>`
      INSERT INTO organizations (name, owner_user_id, unified_key)
      VALUES (${name}, ${userId}, ${unifiedKey}) RETURNING id`;
    await tx`INSERT INTO memberships (org_id, user_id, role) VALUES (${o.id}, ${userId}, 'owner')
             ON CONFLICT (org_id, user_id) DO NOTHING`;
    await tx`
      INSERT INTO fallback_config (org_id, model_db_id, priority, enabled)
      SELECT ${o.id}, model_db_id, priority, enabled FROM fallback_config WHERE org_id IS NULL
      ON CONFLICT (org_id, model_db_id) DO NOTHING`;
    await tx`
      INSERT INTO api_clients (org_id, name, key_prefix, key_hash)
      VALUES (${o.id}, 'Default', ${unifiedKey.slice(0, 16)}, ${sha256(unifiedKey)})
      ON CONFLICT (key_hash) DO NOTHING`;
    return o.id;
  });
}

export type CredResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'invalid' | 'unverified' };

/**
 * Verify credentials. `invalid` = wrong email/password (same message either way,
 * no enumeration). `unverified` = correct credentials but the email hasn't been
 * confirmed — login is blocked until verification.
 */
export async function verifyCredentials(email: string, password: string): Promise<CredResult> {
  const [row] = await sql<{ id: number; email: string; password_hash: string; email_verified: number; org_id: number | null }[]>`
    SELECT u.id, u.email, u.password_hash, u.email_verified,
           (SELECT org_id FROM memberships WHERE user_id = u.id ORDER BY id LIMIT 1) AS org_id
    FROM users u WHERE u.email = ${normalizeEmail(email)}`;
  if (!row) return { ok: false, reason: 'invalid' };
  if (!verifyPassword(password, row.password_hash)) return { ok: false, reason: 'invalid' };
  if (row.email_verified !== 1) return { ok: false, reason: 'unverified' };
  const orgId = row.org_id ?? await provisionOrgForUser(row.id, row.email);
  return { ok: true, user: { userId: row.id, email: row.email, orgId } };
}

/**
 * Find-or-create a user from a verified OAuth identity (e.g. GitHub). Matched by
 * email: an existing account is logged in (and marked verified); a new one is
 * created with a random unusable password (the user can set one later via the
 * reset flow) and a fresh org. The provider already verified the email, so the
 * account is verified immediately and skips the email-verification gate.
 */
export async function findOrCreateOAuthUser(email: string, fullName?: string): Promise<{ user: SessionUser; isNew: boolean }> {
  const normalized = normalizeEmail(email);
  const [existing] = await sql<{ id: number }[]>`SELECT id FROM users WHERE email = ${normalized}`;
  if (existing) {
    // Same email as an existing (email/password or earlier OAuth) account → log
    // into THAT account, never a duplicate. Mark verified since the provider did.
    await sql`UPDATE users SET email_verified = 1 WHERE id = ${existing.id}`;
    const [m] = await sql<{ org_id: number }[]>`SELECT org_id FROM memberships WHERE user_id = ${existing.id} ORDER BY id LIMIT 1`;
    const orgId = m?.org_id ?? await provisionOrgForUser(existing.id, normalized);
    return { user: { userId: existing.id, email: normalized, orgId }, isNew: false };
  }
  const randomPw = crypto.randomBytes(32).toString('hex');
  const created = await createUser(normalized, randomPw, { fullName });
  await markEmailVerified(created.userId);
  return { user: created, isNew: true };
}

// ── Email verification + password reset tokens ───────────────────────────────
type TokenKind = 'verify' | 'reset';
const VERIFY_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const RESET_TTL_MS = 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;     // 10 minutes — password-reset code

/**
 * Password reset by short numeric OTP (6 digits) instead of a magic link.
 * Creating a fresh code invalidates the user's prior unused reset codes so only
 * the latest one works. Returns the RAW code; only its SHA-256 hash is stored.
 * Brute force is bounded by: 6-digit space, 10-minute TTL, single-use, and the
 * per-IP auth rate limiter on /api/auth.
 */
export async function createResetOtp(userId: number): Promise<string> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await sql`UPDATE email_tokens SET used_at = now()
            WHERE user_id = ${userId} AND kind = 'reset' AND used_at IS NULL`;
  await sql`INSERT INTO email_tokens (user_id, kind, token_hash, expires_at)
            VALUES (${userId}, 'reset', ${sha256(code)}, ${expiresAt})`;
  return code;
}

/** Peek: is this reset code currently valid for the email? Does NOT consume it
    (used for live "as you type" verification in the reset form). */
export async function checkResetOtp(email: string, code: string): Promise<boolean> {
  if (!/^\d{6,8}$/.test(code)) return false;
  const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE email = ${normalizeEmail(email)}`;
  if (!u) return false;
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM email_tokens
    WHERE user_id = ${u.id} AND kind = 'reset' AND token_hash = ${sha256(code)}
      AND used_at IS NULL AND expires_at > now()`;
  return !!row;
}

/** Verify a reset code for an email. Returns the userId on success, else null. */
export async function consumeResetOtp(email: string, code: string): Promise<number | null> {
  if (!/^\d{6,8}$/.test(code)) return null;
  const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE email = ${normalizeEmail(email)}`;
  if (!u) return null;
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM email_tokens
    WHERE user_id = ${u.id} AND kind = 'reset' AND token_hash = ${sha256(code)}
      AND used_at IS NULL AND expires_at > now()`;
  if (!row) return null;
  await sql`UPDATE email_tokens SET used_at = now() WHERE id = ${row.id}`;
  return u.id;
}

/** Create a single-use token (returns the RAW token; only its hash is stored). */
export async function createEmailToken(userId: number, kind: TokenKind): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = kind === 'reset' ? RESET_TTL_MS : VERIFY_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  await sql`
    INSERT INTO email_tokens (user_id, kind, token_hash, expires_at)
    VALUES (${userId}, ${kind}, ${sha256(token)}, ${expiresAt})`;
  return token;
}

/** Consume a token: must match kind, be unused and unexpired. Returns userId or null. */
export async function consumeEmailToken(token: string, kind: TokenKind): Promise<number | null> {
  if (!token) return null;
  const [row] = await sql<{ id: number; user_id: number }[]>`
    SELECT id, user_id FROM email_tokens
    WHERE token_hash = ${sha256(token)} AND kind = ${kind}
      AND used_at IS NULL AND expires_at > now()`;
  if (!row) return null;
  await sql`UPDATE email_tokens SET used_at = now() WHERE id = ${row.id}`;
  return row.user_id;
}

/** Look up a user id by email (for resend / forgot flows). Null if absent. */
export async function findUserByEmail(email: string): Promise<{ id: number; emailVerified: boolean } | null> {
  const [row] = await sql<{ id: number; email_verified: number }[]>`
    SELECT id, email_verified FROM users WHERE email = ${normalizeEmail(email)}`;
  return row ? { id: row.id, emailVerified: row.email_verified === 1 } : null;
}

export async function markEmailVerified(userId: number): Promise<void> {
  await sql`UPDATE users SET email_verified = 1 WHERE id = ${userId}`;
}

/** Set a new password and invalidate all of the user's existing sessions. */
export async function setPassword(userId: number, newPassword: string): Promise<void> {
  await sql.begin(async tx => {
    await tx`UPDATE users SET password_hash = ${hashPassword(newPassword)} WHERE id = ${userId}`;
    await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
  });
}

/** Mint a session and return the raw token (only the hash is persisted). */
export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at_ms)
    VALUES (${sha256(token)}, ${userId}, ${Date.now() + SESSION_TTL_MS})`;
  return token;
}

/** Resolve a session token to its user (+ active org), or null if missing/expired. */
export async function validateSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const hash = sha256(token);
  const [row] = await sql<{ user_id: number; expires_at_ms: number; email: string; org_id: number | null }[]>`
    SELECT s.user_id, s.expires_at_ms, u.email,
           (SELECT org_id FROM memberships WHERE user_id = u.id ORDER BY id LIMIT 1) AS org_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash}`;
  if (!row) return null;
  if (row.expires_at_ms < Date.now()) {
    await sql`DELETE FROM sessions WHERE token_hash = ${hash}`;
    return null;
  }
  // Self-heal legacy orphan accounts (no org) on the next authenticated request.
  const orgId = row.org_id ?? await provisionOrgForUser(row.user_id, row.email);
  return { userId: row.user_id, email: row.email, orgId };
}

export async function deleteSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
}
