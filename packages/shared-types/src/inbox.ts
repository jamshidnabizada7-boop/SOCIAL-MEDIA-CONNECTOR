import type { ProviderId } from "./index.js";

export const INBOX_EVENT_TYPES = [
  "comment",
  "reply",
  "mention",
  "direct_message",
  "reaction",
  "repost",
  "follow",
  "other_activity",
] as const;
export type InboxEventType = (typeof INBOX_EVENT_TYPES)[number];
export type InboxReplyState =
  | "queued"
  | "sending"
  | "confirmed"
  | "failed"
  | "unknown";
export interface InboxSender {
  id: string;
  name: string;
  handle?: string;
  avatarUrl?: string;
}
export interface InboxMessage {
  id: string;
  externalId: string;
  direction: "incoming" | "outgoing";
  text: string;
  sender: InboxSender;
  occurredAt: string;
  url?: string;
  deleted?: boolean;
}
export interface InboxReplyAction {
  id: string;
  itemId: string;
  text: string;
  state: InboxReplyState;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  providerMessageId: string | null;
  nativeUrl: string | null;
}
export interface InboxItem {
  id: string;
  accountId: string;
  accountName: string;
  provider: ProviderId;
  externalId: string;
  type: InboxEventType;
  sender: InboxSender;
  text: string;
  nativeUrl: string | null;
  post: {
    id: string;
    text?: string;
    url?: string;
    thumbnailUrl?: string;
  } | null;
  occurredAt: string;
  lastActivityAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  archivedAt: string | null;
  assignedTo: string | null;
  repliedAt: string | null;
  lastHandledBy: string | null;
  deletedAt: string | null;
  replyAllowed: boolean;
  replyCharacterLimit?: number;
  replyReason: string | null;
  replyState: InboxReplyState | null;
}
export interface InboxCapability {
  provider: ProviderId;
  implemented: boolean;
  eventTypes: InboxEventType[];
  replyTypes: InboxEventType[];
  status:
    | "available"
    | "missing_permissions"
    | "not_implemented"
    | "disconnected";
  missingScopes: string[];
  missingReplyScopes: string[];
  maxReplyLength: number;
  reason: string;
  approvalNote?: string;
  syncMethod: "polling" | "webhook_and_polling" | "none";
}
export interface InboxAccount {
  id: string;
  name: string;
  handle: string;
  provider: ProviderId;
  capability: InboxCapability;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  syncStatus: string;
  syncError: string | null;
}
export interface InboxFilters {
  view?:
    | "all"
    | "unread"
    | "needs_reply"
    | "assigned"
    | "unassigned"
    | "unresolved"
    | "resolved"
    | "archived";
  types?: InboxEventType[];
  accountIds?: string[];
  provider?: ProviderId;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}
export interface InboxCounts {
  all: number;
  unread: number;
  needsReply: number;
  unresolved: number;
  assigned: number;
  resolved: number;
  archived: number;
  byProvider: Partial<Record<ProviderId, number>>;
  byAccount: Record<string, number>;
}
export interface InboxPreferences {
  enabledTypes: InboxEventType[];
  priorityTypes: InboxEventType[];
}
export const DEFAULT_INBOX_PREFERENCES: InboxPreferences = {
  enabledTypes: [...INBOX_EVENT_TYPES],
  priorityTypes: ["comment", "reply", "mention", "direct_message"],
};
export interface InboxDetail {
  item: InboxItem;
  messages: InboxMessage[];
  actions: InboxReplyAction[];
  activity: Array<{ action: string; actorId: string | null; at: string }>;
  contextRefreshedAt: string | null;
}
