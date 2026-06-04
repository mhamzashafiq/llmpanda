CREATE TABLE "api_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_clients_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"platform" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"encrypted_key" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"base_url" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer,
	"user_id" integer,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" integer,
	"type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "fallback_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer,
	"model_db_id" integer NOT NULL,
	"priority" integer NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"org_id" integer,
	"email" text NOT NULL,
	"full_name" text,
	"company" text,
	"role" text,
	"team_size" text,
	"use_case" text,
	"source" text,
	"marketing_opt_in" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"intelligence_rank" integer NOT NULL,
	"speed_rank" integer NOT NULL,
	"size_label" text DEFAULT '' NOT NULL,
	"rpm_limit" integer,
	"rpd_limit" integer,
	"tpm_limit" integer,
	"tpd_limit" integer,
	"monthly_token_budget" text DEFAULT '' NOT NULL,
	"context_window" integer,
	"enabled" integer DEFAULT 1 NOT NULL,
	"supports_vision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" integer,
	"unified_key" text,
	"dek_wrapped" text,
	"dek_iv" text,
	"dek_tag" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"plan_status" text DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_unified_key_unique" UNIQUE("unified_key")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_cooldowns" (
	"org_id" integer NOT NULL,
	"platform" text NOT NULL,
	"model_id" text NOT NULL,
	"key_id" integer NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"platform" text NOT NULL,
	"model_id" text NOT NULL,
	"key_id" integer NOT NULL,
	"kind" text NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"platform" text NOT NULL,
	"model_id" text NOT NULL,
	"key_id" integer,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ttfb_ms" integer,
	"prompt" text,
	"response" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text,
	"email_verified" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fallback_config" ADD CONSTRAINT "fallback_config_model_db_id_models_id_fk" FOREIGN KEY ("model_db_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_clients_org" ON "api_clients" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_api_clients_hash" ON "api_clients" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_api_keys_platform" ON "api_keys" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_audit_log_org" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_email_tokens_hash" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_email_tokens_user" ON "email_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fallback_config_org_model_key" ON "fallback_config" USING btree ("org_id","model_db_id");--> statement-breakpoint
CREATE INDEX "idx_fallback_config_org" ON "fallback_config" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_key" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_memberships_user" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "models_platform_model_id_key" ON "models" USING btree ("platform","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_cooldowns_pkey" ON "rate_limit_cooldowns" USING btree ("platform","model_id","key_id");--> statement-breakpoint
CREATE INDEX "idx_rate_limit_cooldowns_expires" ON "rate_limit_cooldowns" USING btree ("expires_at_ms");--> statement-breakpoint
CREATE INDEX "idx_rate_limit_usage_lookup" ON "rate_limit_usage" USING btree ("platform","model_id","key_id","kind","created_at_ms");--> statement-breakpoint
CREATE INDEX "idx_requests_created_at" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_requests_platform" ON "requests" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_requests_key_id" ON "requests" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");