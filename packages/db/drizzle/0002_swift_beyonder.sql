CREATE TABLE "provider_app_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"instance_url" text DEFAULT '*' NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_app_configs_unique" UNIQUE("provider_id","instance_url")
);
