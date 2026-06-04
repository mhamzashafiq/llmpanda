/**
 * Standalone cross-tenant isolation verifier (Phase 7). Runs against a LIVE
 * server (default http://localhost:3001) — no test harness needed:
 *
 *   npx tsx src/scripts/verify-isolation.ts
 *
 * Registers two fresh orgs and asserts org B can neither see nor mutate org A's
 * data. Exits non-zero on any isolation failure. This is the no-RLS backstop:
 * run it in CI against a booted server.
 */
const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3001';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function api(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, body: json };
}

async function register(tag: string): Promise<string> {
  const email = `iso-${tag}-${Math.floor(Math.random() * 1e9)}@llmpanda.test`;
  const pw = 'TestPass123!';
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw, company: `iso-${tag}` }),
  });
  // Email verification gates login; bypass the email step for this test (the
  // isolation logic under test is unrelated to verification) by marking the
  // account verified directly, then logging in for a real session token.
  const { sql } = await import('../db/client.js');
  await sql`UPDATE users SET email_verified = 1 WHERE email = ${email.toLowerCase()}`;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  const json = await res.json();
  if (!json.token) throw new Error(`login failed for ${email}: ${JSON.stringify(json)}`);
  return json.token;
}

async function main() {
  console.log(`[verify-isolation] target ${BASE}`);
  const a = await register('A');
  const b = await register('B');

  // A adds a uniquely-labelled provider key.
  const label = `A-SECRET-${Math.floor(Math.random() * 1e6)}`;
  const add = await api(a, 'POST', '/api/keys', { platform: 'groq', key: `gsk_iso_${Date.now()}`, label });
  check('A can add a provider key', add.status === 201, `status ${add.status}`);
  const aKeyId: number | undefined = add.body?.id;

  // B must NOT see A's key.
  const bKeys = await api(b, 'GET', '/api/keys');
  const bSeesA = Array.isArray(bKeys.body) && bKeys.body.some((k: any) => k.id === aKeyId || k.label === label);
  check('B cannot see A\'s provider key', !bSeesA);
  check('B\'s key list is its own (empty)', Array.isArray(bKeys.body) && bKeys.body.length === 0, `got ${bKeys.body?.length}`);

  // B must NOT be able to delete A's key (IDOR) — expect 404.
  if (aKeyId != null) {
    const del = await api(b, 'DELETE', `/api/keys/${aKeyId}`);
    check('B cannot delete A\'s key (404)', del.status === 404, `status ${del.status}`);
  }

  // A's key still present after B's attempt.
  const aKeys = await api(a, 'GET', '/api/keys');
  check('A still owns its key', Array.isArray(aKeys.body) && aKeys.body.some((k: any) => k.id === aKeyId));

  // B's analytics must not reflect A's data (B made no requests).
  const bSummary = await api(b, 'GET', '/api/analytics/summary');
  check('B analytics is isolated (0 requests)', bSummary.body?.totalRequests === 0, `got ${bSummary.body?.totalRequests}`);

  // B cannot read A's audit trail / client keys.
  const bClients = await api(b, 'GET', '/api/settings/clients');
  const aClients = await api(a, 'GET', '/api/settings/clients');
  const overlap = Array.isArray(bClients.body) && Array.isArray(aClients.body)
    && bClients.body.some((bc: any) => aClients.body.some((ac: any) => ac.id === bc.id));
  check('B and A share no client keys', !overlap);

  console.log(failures === 0 ? '\nISOLATION OK' : `\nISOLATION FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error('verify-isolation error:', err); process.exit(1); });
