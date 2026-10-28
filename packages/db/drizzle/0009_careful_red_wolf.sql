CREATE TABLE "feed_follows" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"author_id" text NOT NULL,
	"source_id" uuid,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_follows_user_id_provider_author_id_pk" PRIMARY KEY("user_id","provider","author_id")
);
--> statement-breakpoint
CREATE TABLE "feed_interactions" (
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"reported_unavailable" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_interactions_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_post_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "feed_items_source_post" UNIQUE("source_id","provider_post_id")
);
--> statement-breakpoint
CREATE TABLE "feed_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preferences" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_saved" (
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_saved_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "feed_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"filter_key" text NOT NULL,
	"item_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"account_id" uuid,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"source_key" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_source_owner_key" UNIQUE("user_id","source_key")
);
--> statement-breakpoint
CREATE TABLE "feed_sync_state" (
	"source_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "feed_follows" ADD CONSTRAINT "feed_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_follows" ADD CONSTRAINT "feed_follows_source_id_feed_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."feed_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_interactions" ADD CONSTRAINT "feed_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_interactions" ADD CONSTRAINT "feed_interactions_item_id_feed_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_source_id_feed_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."feed_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_preferences" ADD CONSTRAINT "feed_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_saved" ADD CONSTRAINT "feed_saved_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_saved" ADD CONSTRAINT "feed_saved_item_id_feed_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sessions" ADD CONSTRAINT "feed_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sessions" ADD CONSTRAINT "feed_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_account_id_workspace_id_social_accounts_id_workspace_id_fk" FOREIGN KEY ("account_id","workspace_id") REFERENCES "public"."social_accounts"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sync_state" ADD CONSTRAINT "feed_sync_state_source_id_feed_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."feed_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_items_source_expiry" ON "feed_items" USING btree ("source_id","expires_at");--> statement-breakpoint
CREATE INDEX "feed_items_expiry" ON "feed_items" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "feed_sessions_owner_expiry" ON "feed_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "feed_sessions_expiry" ON "feed_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "feed_sources_owner_workspace" ON "feed_sources" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "feed_sync_due" ON "feed_sync_state" USING btree ("next_sync_at","lease_expires_at");