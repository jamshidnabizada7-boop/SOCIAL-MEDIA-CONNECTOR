import type {
  InboxCapability,
  InboxEventType,
  ProviderId,
} from "@aria/shared-types";
import type { EngagementAccount } from "./contract.js";

export const INBOX_OAUTH_SCOPES: Partial<Record<ProviderId, string[]>> = {
  facebook: [
    "pages_read_engagement",
    "pages_manage_engagement",
    "pages_read_user_content",
  ],
  instagram: [
    "instagram_basic",
    "instagram_manage_comments",
    "pages_show_list",
    "pages_read_engagement",
  ],
  youtube: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ],
};
type Definition = {
  events: InboxEventType[];
  replies: InboxEventType[];
  read: string[];
  write: string[];
  max: number;
  note?: string;
};
const DEFINITIONS: Partial<Record<ProviderId, Definition>> = {
  bluesky: {
    events: [
      "mention",
      "reply",
      "reaction",
      "repost",
      "follow",
      "other_activity",
    ],
    replies: ["mention", "reply"],
    read: [],
    write: [],
    max: 300,
  },
  mastodon: {
    events: [
      "mention",
      "reply",
      "direct_message",
      "reaction",
      "repost",
      "follow",
      "other_activity",
    ],
    replies: ["mention", "reply", "direct_message"],
    read: ["read:notifications", "read:statuses"],
    write: ["write:statuses"],
    max: 500,
  },
  youtube: {
    events: ["comment", "reply"],
    replies: ["comment", "reply"],
    read: ["https://www.googleapis.com/auth/youtube.readonly"],
    write: ["https://www.googleapis.com/auth/youtube.force-ssl"],
    max: 10000,
    note: "Google OAuth consent verification and YouTube quota apply. Private messages are not part of this integration.",
  },
  facebook: {
    events: ["comment", "reply"],
    replies: ["comment", "reply"],
    read: ["pages_read_engagement", "pages_read_user_content"],
    write: ["pages_manage_engagement"],
    max: 8000,
    note: "Comments on 10 recent Page posts; bounded pagination. Meta review and Page moderation tasks apply. Messenger and personal-profile notifications are not implemented.",
  },
  instagram: {
    events: ["comment", "reply"],
    replies: ["comment", "reply"],
    read: [
      "instagram_basic",
      "instagram_manage_comments",
      "pages_read_engagement",
    ],
    write: ["instagram_manage_comments"],
    max: 2200,
    note: "Comments on 10 recent professional-account media; bounded pagination. Meta review applies. Instagram messages and mentions are not implemented.",
  },
};
export function hasInboxScope(scopes: string[], required: string): boolean {
  if (scopes.includes(required)) return true;
  if (required.startsWith("read:") && scopes.includes("read")) return true;
  if (required.startsWith("write:") && scopes.includes("write")) return true;
  if (
    required.includes("youtube.readonly") &&
    scopes.some(
      (s) => s.endsWith("/youtube.force-ssl") || s.endsWith("/youtube"),
    )
  )
    return true;
  return (
    required.endsWith("/youtube.force-ssl") &&
    scopes.some((s) => s.endsWith("/youtube"))
  );
}
export function engagementCapabilities(
  account: EngagementAccount,
): InboxCapability {
  const definition = DEFINITIONS[account.provider];
  const base = {
    provider: account.provider,
    missingScopes: [],
    missingReplyScopes: [],
    maxReplyLength: definition?.max ?? 0,
  };
  if (!definition)
    return {
      ...base,
      implemented: false,
      status: "not_implemented",
      eventTypes: [],
      replyTypes: [],
      reason:
        "Social Inbox support for this provider has not been implemented. Publishing access is separate; use the native platform for interactions.",
      syncMethod: "none",
    };
  const missingScopes = definition.read.filter(
    (scope) => !hasInboxScope(account.scopes, scope),
  );
  const missingReplyScopes = definition.write.filter(
    (scope) => !hasInboxScope(account.scopes, scope),
  );
  const disconnected = [
    "needs_reauth",
    "disconnected",
    "permission_missing",
  ].includes(account.connection);
  return {
    ...base,
    implemented: true,
    status: disconnected
      ? "disconnected"
      : missingScopes.length
        ? "missing_permissions"
        : "available",
    missingScopes,
    missingReplyScopes,
    eventTypes: definition.events,
    replyTypes:
      !disconnected && !missingScopes.length && !missingReplyScopes.length
        ? definition.replies
        : [],
    reason: disconnected
      ? "Reconnect this account before synchronizing interactions."
      : missingScopes.length
        ? "Additional inbox permissions are needed. Existing publishing access is preserved."
        : missingReplyScopes.length
          ? "Reading is enabled. Additional permission is needed to send replies."
          : "API integration enabled; live account acceptance is still required. Updates are synchronized periodically.",
    approvalNote: definition.note,
    syncMethod: ["facebook", "instagram"].includes(account.provider)
      ? "webhook_and_polling"
      : "polling",
  };
}
