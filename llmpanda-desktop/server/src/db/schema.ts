/**
 * Drizzle Postgres schema — faithful port of the original better-sqlite3 tables
 * (Phase 1, no tenancy yet). Conventions kept close to the SQLite shape to limit
 * query churn: integer 0/1 booleans, epoch-ms columns as bigint, ids as serial.
 * `org_id` + multi-tenant tables land in Phase 2.
 */
import { pgTable, serial, integer, bigint, text, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const models = pgTable(
  'models',
  {
    id: serial('id').primaryKey(),
    platform: text('platform').notNull(),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    intelligenceRank: integer('intelligence_rank').notNull(),
    speedRank: integer('speed_rank').notNull(),
    sizeLabel: text('size_label').notNull().default(''),
    rpmLimit: integer('rpm_limit'),
    rpdLimit: integer('rpd_limit'),
    tpmLimit: integer('tpm_limit'),
    tpdLimit: integer('tpd_limit'),
    monthlyTokenBudget: text('monthly_token_budget').notNull().default(''),
    contextWindow: integer('context_window'),
    enabled: integer('enabled').notNull().default(1),
    supportsVision: integer('supports_vision').notNull().default(0),
  },
  t => ({ platformModel: uniqueIndex('models_platform_model_id_key').on(t.platform, t.modelId) }),
)

export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull(),
    platform: text('platform').notNull(),
    label: text('label').notNull().default(''),
    encryptedKey: text('encrypted_key').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    status: text('status').notNull().default('unknown'),
    enabled: integer('enabled').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    baseUrl: text('base_url'),
  },
  t => ({ platformIdx: index('idx_api_keys_platform').on(t.platform) }),
)

export const requests = pgTable(
  'requests',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull(),
    platform: text('platform').notNull(),
    modelId: text('model_id').notNull(),
    keyId: integer('key_id'),
    status: text('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ttfbMs: integer('ttfb_ms'),
    // Truncated prompt + response previews for the detailed logs view.
    prompt: text('prompt'),
    response: text('response'),
  },
  t => ({
    createdAtIdx: index('idx_requests_created_at').on(t.createdAt),
    platformIdx: index('idx_requests_platform').on(t.platform),
    keyIdIdx: index('idx_requests_key_id').on(t.keyId),
  }),
)

export const rateLimitUsage = pgTable(
  'rate_limit_usage',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull(),
    platform: text('platform').notNull(),
    modelId: text('model_id').notNull(),
    keyId: integer('key_id').notNull(),
    kind: text('kind').notNull(), // 'request' | 'tokens'
    tokens: integer('tokens').notNull().default(0),
    createdAtMs: bigint('created_at_ms', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    lookup: index('idx_rate_limit_usage_lookup').on(t.platform, t.modelId, t.keyId, t.kind, t.createdAtMs),
  }),
)

export const rateLimitCooldowns = pgTable(
  'rate_limit_cooldowns',
  {
    orgId: integer('org_id').notNull(),
    platform: text('platform').notNull(),
    modelId: text('model_id').notNull(),
    keyId: integer('key_id').notNull(),
    expiresAtMs: bigint('expires_at_ms', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    pk: uniqueIndex('rate_limit_cooldowns_pkey').on(t.platform, t.modelId, t.keyId),
    expiresIdx: index('idx_rate_limit_cooldowns_expires').on(t.expiresAtMs),
  }),
)

export const fallbackConfig = pgTable(
  'fallback_config',
  {
    id: serial('id').primaryKey(),
    // Nullable on purpose: rows with org_id IS NULL are the shared seed TEMPLATE
    // that each new org is cloned from. Every routing/dashboard query filters by
    // org_id, so template rows are never served to a tenant.
    orgId: integer('org_id'),
    modelDbId: integer('model_db_id').notNull().references(() => models.id),
    priority: integer('priority').notNull(),
    enabled: integer('enabled').notNull().default(1),
  },
  t => ({
    orgModelUnique: uniqueIndex('fallback_config_org_model_key').on(t.orgId, t.modelDbId),
    orgIdx: index('idx_fallback_config_org').on(t.orgId),
  }),
)

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  emailVerified: integer('email_verified').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Single-use, expiring tokens for email verification + password reset (hash only).
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'verify' | 'reset'
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    hashIdx: index('idx_email_tokens_hash').on(t.tokenHash),
    userIdx: index('idx_email_tokens_user').on(t.userId),
  }),
)

// Lead-generation capture at signup (marketing / sales qualification).
export const leads = pgTable('leads', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  orgId: integer('org_id').references(() => organizations.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  fullName: text('full_name'),
  company: text('company'),
  role: text('role'),
  teamSize: text('team_size'),
  useCase: text('use_case'),
  source: text('source'),
  marketingOptIn: integer('marketing_opt_in').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Phase 2: tenancy ─────────────────────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  ownerUserId: integer('owner_user_id').references(() => users.id),
  // Per-org unified API key — the credential app clients send to /v1. Resolving
  // it yields the tenant; the proxy then uses only that org's provider keys.
  // (Superseded by api_clients for multi-key; kept as the legacy default.)
  unifiedKey: text('unified_key').unique(),
  // Envelope encryption: each org has its own data-encryption key (DEK), stored
  // wrapped (AES-256-GCM) by the master KEK that lives in env — never plaintext,
  // never the KEK, in the DB. A DB leak yields only wrapped DEKs.
  dekWrapped: text('dek_wrapped'),
  dekIv: text('dek_iv'),
  dekTag: text('dek_tag'),
  // Phase 4/5: plan entitlements + Stripe linkage.
  plan: text('plan').notNull().default('free'),
  planStatus: text('plan_status').notNull().default('active'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const billingEvents = pgTable('billing_events', {
  id: text('id').primaryKey(), // Stripe event id (idempotency)
  orgId: integer('org_id').references(() => organizations.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Phase 3: per-org client API keys. Multiple named, revocable keys per org for
// the /v1 proxy. Only the SHA-256 hash is stored; the plaintext is shown once at
// creation. keyPrefix (e.g. "llmpanda-1a2b3c") is for display/identification.
export const apiClients = pgTable(
  'api_clients',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Default'),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    // Optional JSON array of model db ids this key may route to (the "Coding
    // Agents" allow-list). NULL / empty = no restriction (full org chain).
    allowedModelIds: text('allowed_model_ids'),
    // Per-key request transforms. token_saver: RTK-compress bulky tool output.
    // terse_mode + terse_level: inject a brevity (caveman) system prompt.
    tokenSaver: integer('token_saver').notNull().default(0),
    terseMode: integer('terse_mode').notNull().default(0),
    terseLevel: text('terse_level'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    orgIdx: index('idx_api_clients_org').on(t.orgId),
    hashIdx: index('idx_api_clients_hash').on(t.keyHash),
  }),
)

export const memberships = pgTable(
  'memberships',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // owner | admin | member
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    orgUser: uniqueIndex('memberships_org_user_key').on(t.orgId, t.userId),
    userIdx: index('idx_memberships_user').on(t.userId),
  }),
)

// Phase 7: append-only audit trail of security-relevant actions (key add/delete,
// client-key create/revoke, GDPR export/delete, etc.). org-scoped for tenant reads.
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id'),
    userId: integer('user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    meta: jsonb('meta'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({ orgIdx: index('idx_audit_log_org').on(t.orgId, t.createdAt) }),
)

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAtMs: bigint('expires_at_ms', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({ userIdx: index('idx_sessions_user').on(t.userId) }),
)
