CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
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
CREATE TABLE "fallback_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_db_id" integer NOT NULL,
	"priority" integer NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL
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
CREATE TABLE "rate_limit_cooldowns" (
	"platform" text NOT NULL,
	"model_id" text NOT NULL,
	"key_id" integer NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_usage" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"platform" text NOT NULL,
	"model_id" text NOT NULL,
	"key_id" integer,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ttfb_ms" integer
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "fallback_config" ADD CONSTRAINT "fallback_config_model_db_id_models_id_fk" FOREIGN KEY ("model_db_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_keys_platform" ON "api_keys" USING btree ("platform");--> statement-breakpoint
CREATE UNIQUE INDEX "fallback_config_model_db_id_key" ON "fallback_config" USING btree ("model_db_id");--> statement-breakpoint
CREATE UNIQUE INDEX "models_platform_model_id_key" ON "models" USING btree ("platform","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_cooldowns_pkey" ON "rate_limit_cooldowns" USING btree ("platform","model_id","key_id");--> statement-breakpoint
CREATE INDEX "idx_rate_limit_cooldowns_expires" ON "rate_limit_cooldowns" USING btree ("expires_at_ms");--> statement-breakpoint
CREATE INDEX "idx_rate_limit_usage_lookup" ON "rate_limit_usage" USING btree ("platform","model_id","key_id","kind","created_at_ms");--> statement-breakpoint
CREATE INDEX "idx_requests_created_at" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_requests_platform" ON "requests" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_requests_key_id" ON "requests" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");