import { pgEnum } from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", ["active", "invited", "suspended"]);
export const memberRole = pgEnum("member_role", [
  "owner",
  "admin",
  "manager",
  "editor",
  "approver",
  "viewer",
]);
export const memberStatus = pgEnum("member_status", ["invited", "active"]);

export const providerStatus = pgEnum("provider_status", [
  "active",
  "degraded",
  "maintenance",
  "disabled",
]);
export const providerApproval = pgEnum("provider_approval", ["approved", "pending", "testing"]);
export const connectionState = pgEnum("connection_state", [
  "healthy",
  "needs_reauth",
  "token_expiring",
  "permission_missing",
  "disconnected",
]);

export const mediaKind = pgEnum("media_kind", ["image", "video", "document"]);
export const mediaStatus = pgEnum("media_status", ["ready", "processing", "failed"]);

export const postState = pgEnum("post_state", [
  "draft",
  "ready",
  "scheduled",
  "queued",
  "processing",
  "partially_published",
  "published",
  "failed",
  "canceled",
  "archived",
]);
export const targetState = pgEnum("target_state", [
  "pending",
  "validating",
  "queued",
  "uploading_media",
  "publishing",
  "provider_processing",
  "published",
  "retrying",
  "needs_user_action",
  "failed",
  "token_expired",
  "canceled",
]);

export const jobState = pgEnum("job_state", [
  "pending",
  "active",
  "completed",
  "failed",
  "delayed",
  "dead_letter",
]);

export const notificationSeverity = pgEnum("notification_severity", [
  "info",
  "success",
  "warning",
  "error",
]);
export const webhookStatus = pgEnum("webhook_status", [
  "pending",
  "processed",
  "duplicate",
  "failed",
]);
