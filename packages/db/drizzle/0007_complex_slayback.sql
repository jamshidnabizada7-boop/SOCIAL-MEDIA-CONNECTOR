CREATE TABLE "social_inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"sender" jsonb NOT NULL,
	"text" text NOT NULL,
	"native_url" text,
	"conversation_id" text,
	"post" jsonb,
	"reply_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reply_allowed" boolean DEFAULT false NOT NULL,
	"reply_reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"archived_at" timestamp with time zone,
	"assigned_to" uuid,
	"replied_at" timestamp with time zone,
	"last_handled_by" uuid,
	"deleted_at" timestamp with time zone,
	"context_requested_at" timestamp with time zone,
	"context_refreshed_at" timestamp with time zone,
	CONSTRAINT "inbox_account_event_unique" UNIQUE("account_id","external_id"),
	CONSTRAINT "inbox_id_workspace_unique" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "social_inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"direction" text NOT NULL,
	"sender" jsonb NOT NULL,
	"text" text NOT NULL,
	"native_url" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "inbox_message_external_unique" UNIQUE("item_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "social_inbox_preferences" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"preferences" jsonb NOT NULL,
	CONSTRAINT "social_inbox_preferences_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "social_inbox_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"digest" text NOT NULL,
	"matched_accounts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_webhook_dedupe_unique" UNIQUE("provider_id","digest")
);
--> statement-breakpoint
CREATE TABLE "social_reply_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"text" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" uuid,
	"lease_expires_at" timestamp with time zone,
	"provider_message_id" text,
	"native_url" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "inbox_reply_idempotency_unique" UNIQUE("workspace_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "social_sync_state" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_requested_at" timestamp with time zone,
	"last_error" text,
	"locked_by" uuid,
	"lease_expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "social_inbox_items" ADD CONSTRAINT "social_inbox_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_items" ADD CONSTRAINT "social_inbox_items_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_items" ADD CONSTRAINT "social_inbox_items_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_items" ADD CONSTRAINT "social_inbox_items_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_items" ADD CONSTRAINT "social_inbox_items_last_handled_by_users_id_fk" FOREIGN KEY ("last_handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_messages" ADD CONSTRAINT "social_inbox_messages_item_id_workspace_id_social_inbox_items_id_workspace_id_fk" FOREIGN KEY ("item_id","workspace_id") REFERENCES "public"."social_inbox_items"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_preferences" ADD CONSTRAINT "social_inbox_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_preferences" ADD CONSTRAINT "social_inbox_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reply_actions" ADD CONSTRAINT "social_reply_actions_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reply_actions" ADD CONSTRAINT "social_reply_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reply_actions" ADD CONSTRAINT "social_reply_actions_item_id_workspace_id_social_inbox_items_id_workspace_id_fk" FOREIGN KEY ("item_id","workspace_id") REFERENCES "public"."social_inbox_items"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_sync_state" ADD CONSTRAINT "social_sync_state_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_sync_state" ADD CONSTRAINT "social_sync_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_workspace_activity_idx" ON "social_inbox_items" USING btree ("workspace_id","last_activity_at","id");--> statement-breakpoint
CREATE INDEX "inbox_workspace_account_type_idx" ON "social_inbox_items" USING btree ("workspace_id","account_id","type");--> statement-breakpoint
CREATE INDEX "inbox_workspace_unread_idx" ON "social_inbox_items" USING btree ("workspace_id","read_at","archived_at");--> statement-breakpoint
CREATE INDEX "inbox_workspace_assignment_idx" ON "social_inbox_items" USING btree ("workspace_id","assigned_to","resolved_at");--> statement-breakpoint
CREATE INDEX "inbox_messages_thread_idx" ON "social_inbox_messages" USING btree ("workspace_id","item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inbox_webhook_retention_idx" ON "social_inbox_webhooks" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "inbox_reply_queue_idx" ON "social_reply_actions" USING btree ("state","run_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "inbox_reply_thread_idx" ON "social_reply_actions" USING btree ("workspace_id","item_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_sync_due_idx" ON "social_sync_state" USING btree ("next_sync_at","lease_expires_at");