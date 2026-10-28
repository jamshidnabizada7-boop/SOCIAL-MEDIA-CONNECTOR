import type {
  InboxEventType,
  InboxMessage,
  InboxSender,
  ProviderId,
} from "@aria/shared-types";
import type { FetchLike } from "../http.js";

export interface EngagementAccount {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  externalAccountId: string;
  displayName: string;
  handle: string;
  scopes: string[];
  connection: string;
  instanceUrl?: string;
}
export interface EngagementContext {
  account: EngagementAccount;
  accessToken: string;
  fetchImpl?: FetchLike;
}
export interface EngagementEvent {
  externalId: string;
  type: InboxEventType;
  sender: InboxSender;
  text: string;
  occurredAt: string;
  nativeUrl?: string;
  conversationId?: string;
  post?: { id: string; text?: string; url?: string; thumbnailUrl?: string };
  replyContext: Record<string, string | string[]>;
  replyAllowed: boolean;
  replyReason?: string;
  deleted?: boolean;
}
export interface EngagementSyncResult {
  events: EngagementEvent[];
  cursor: Record<string, string>;
  hasMore: boolean;
}
export interface EngagementReplyInput {
  actionId: string;
  text: string;
  createdAt: string;
  event: EngagementEvent;
}
export interface EngagementReplyResult {
  externalId: string;
  nativeUrl?: string;
}
export interface SocialEngagementAdapter {
  /** Window during which the same action can be retried without creating a second remote reply. */
  idempotencyWindowMs: number;
  syncEvents(
    ctx: EngagementContext,
    cursor: Record<string, string>,
  ): Promise<EngagementSyncResult>;
  getConversation(
    ctx: EngagementContext,
    event: EngagementEvent,
  ): Promise<InboxMessage[]>;
  sendReply(
    ctx: EngagementContext,
    input: EngagementReplyInput,
  ): Promise<EngagementReplyResult>;
}
