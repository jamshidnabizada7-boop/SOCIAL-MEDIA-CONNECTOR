"use client";
import {
  DEFAULT_INBOX_PREFERENCES,
  type InboxAccount,
  type InboxCounts,
  type InboxDetail,
  type InboxFilters,
  type InboxItem,
  type InboxPreferences,
  type InboxReplyAction,
} from "@aria/shared-types";
import { apiGet, apiPatch, apiPost, DATA_MODE } from "@/lib/api/client";

export type InboxOperation =
  | "read"
  | "unread"
  | "resolve"
  | "reopen"
  | "archive"
  | "unarchive"
  | "assign";
export interface InboxMember {
  id: string;
  name: string;
}
export interface InboxList {
  items: InboxItem[];
  total: number;
  page: number;
  limit: number;
}
export interface InboxService {
  list(ws: string, filters: InboxFilters, userId: string): Promise<InboxList>;
  counts(ws: string, userId: string): Promise<InboxCounts>;
  accounts(ws: string): Promise<InboxAccount[]>;
  members(ws: string, userId: string, name: string): Promise<InboxMember[]>;
  preferences(ws: string): Promise<InboxPreferences>;
  savePreferences(
    ws: string,
    prefs: InboxPreferences,
  ): Promise<InboxPreferences>;
  detail(ws: string, id: string): Promise<InboxDetail>;
  change(
    ws: string,
    ids: string[],
    operation: InboxOperation,
    assignedTo?: string | null,
  ): Promise<void>;
  reply(
    ws: string,
    id: string,
    text: string,
    idempotencyKey: string,
    userId: string,
  ): Promise<void>;
  sync(ws: string): Promise<string>;
  refreshThread(ws: string, id: string): Promise<void>;
}
const path = (ws: string) => `/v1/workspaces/${encodeURIComponent(ws)}/inbox`;
class ApiInbox implements InboxService {
  async list(ws: string, filters: InboxFilters) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (
        value !== undefined &&
        value !== "" &&
        (!Array.isArray(value) || value.length)
      )
        query.set(key, Array.isArray(value) ? value.join(",") : String(value));
    return apiGet<InboxList>(`${path(ws)}?${query}`);
  }
  counts(ws: string) {
    return apiGet<InboxCounts>(`${path(ws)}/counts`);
  }
  async accounts(ws: string) {
    return (await apiGet<{ accounts: InboxAccount[] }>(`${path(ws)}/accounts`))
      .accounts;
  }
  async members(ws: string) {
    return (await apiGet<{ members: InboxMember[] }>(`${path(ws)}/members`))
      .members;
  }
  preferences(ws: string) {
    return apiGet<InboxPreferences>(`${path(ws)}/preferences`);
  }
  savePreferences(ws: string, prefs: InboxPreferences) {
    return apiPatch<InboxPreferences>(`${path(ws)}/preferences`, prefs);
  }
  detail(ws: string, id: string) {
    return apiGet<InboxDetail>(`${path(ws)}/${encodeURIComponent(id)}`);
  }
  async change(
    ws: string,
    ids: string[],
    operation: InboxOperation,
    assignedTo?: string | null,
  ) {
    await apiPost(`${path(ws)}/bulk`, { ids, operation, assignedTo });
  }
  async reply(ws: string, id: string, text: string, idempotencyKey: string) {
    await apiPost(`${path(ws)}/${id}/reply`, { text, idempotencyKey });
  }
  async sync(ws: string) {
    return (await apiPost<{ message: string }>(`${path(ws)}/sync`, {})).message;
  }
  async refreshThread(ws: string, id: string) {
    await apiPost(`${path(ws)}/${id}/refresh`);
  }
}

interface DemoState {
  items: InboxItem[];
  actions: InboxReplyAction[];
  preferences: InboxPreferences;
}
/** Demo state has its own namespace and is never consulted by the API implementation. */
class DemoInbox implements InboxService {
  private states = new Map<string, DemoState>();
  private state(ws: string) {
    if (this.states.has(ws)) return this.states.get(ws)!;
    let saved: DemoState | undefined;
    try {
      saved = JSON.parse(
        localStorage.getItem(`aria-mock:inbox:v1:${ws}`) || "null",
      ) as DemoState | undefined;
    } catch {
      /* unavailable storage starts a fresh demo */
    }
    const now = Date.now();
    const state = saved ?? {
      preferences: structuredClone(DEFAULT_INBOX_PREFERENCES),
      actions: [],
      items: [
        {
          type: "mention",
          provider: "bluesky",
          accountId: "demo-bluesky",
          accountName: "Aria on Bluesky",
          sender: {
            id: "demo-alex",
            name: "Alex Morgan",
            handle: "alex.bsky.social",
          },
          text: "Love the new launch! When will the next update be available?",
          nativeUrl: "https://bsky.app",
        },
        {
          type: "direct_message",
          provider: "mastodon",
          accountId: "demo-mastodon",
          accountName: "Aria on Mastodon",
          sender: {
            id: "demo-lee",
            name: "Lee Chen",
            handle: "lee@example.social",
          },
          text: "Could you help me find the onboarding guide?",
          nativeUrl: null,
        },
        {
          type: "comment",
          provider: "youtube",
          accountId: "demo-youtube",
          accountName: "Aria videos",
          sender: { id: "demo-sam", name: "Sam Rivera" },
          text: "The walkthrough was really helpful. More of these please!",
          nativeUrl: "https://www.youtube.com",
        },
        {
          type: "reaction",
          provider: "bluesky",
          accountId: "demo-bluesky",
          accountName: "Aria on Bluesky",
          sender: { id: "demo-jo", name: "Jo Patel", handle: "jo.bsky.social" },
          text: "Liked your post",
          nativeUrl: "https://bsky.app",
        },
      ].map(
        (sample, i) =>
          ({
            ...sample,
            id: `demo-item-${i}`,
            externalId: `demo-event-${i}`,
            occurredAt: new Date(now - (i + 1) * 1200000).toISOString(),
            lastActivityAt: new Date(now - (i + 1) * 1200000).toISOString(),
            readAt: i === 2 ? new Date(now).toISOString() : null,
            resolvedAt: null,
            resolvedBy: null,
            archivedAt: null,
            assignedTo: null,
            repliedAt: null,
            lastHandledBy: null,
            deletedAt: null,
            replyAllowed: i !== 3,
            replyReason:
              i === 3 ? "Reactions cannot receive a direct reply." : null,
            replyState: null,
            post: null,
          }) as InboxItem,
      ),
    };
    this.states.set(ws, state);
    return state;
  }
  private save(ws: string) {
    try {
      localStorage.setItem(
        `aria-mock:inbox:v1:${ws}`,
        JSON.stringify(this.state(ws)),
      );
    } catch {
      /* current session remains usable */
    }
  }
  async list(ws: string, f: InboxFilters, userId: string) {
    const rows = this.state(ws)
      .items.filter((i) => {
        if (f.view === "archived" ? !i.archivedAt : i.archivedAt) return false;
        if (
          (f.view === "unread" && i.readAt) ||
          (f.view === "needs_reply" &&
            (i.repliedAt || i.resolvedAt || !i.replyAllowed)) ||
          (f.view === "assigned" && i.assignedTo !== userId) ||
          (f.view === "unassigned" && i.assignedTo) ||
          (f.view === "unresolved" && i.resolvedAt) ||
          (f.view === "resolved" && !i.resolvedAt)
        )
          return false;
        return (
          (!f.types?.length || f.types.includes(i.type)) &&
          (!f.accountIds?.length || f.accountIds.includes(i.accountId)) &&
          (!f.provider || f.provider === i.provider) &&
          (!f.search ||
            `${i.text} ${i.sender.name}`
              .toLowerCase()
              .includes(f.search.toLowerCase())) &&
          (!f.from || i.occurredAt >= f.from) &&
          (!f.to || i.occurredAt <= f.to)
        );
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    const page = f.page || 1,
      limit = f.limit || 30;
    return {
      items: structuredClone(rows.slice((page - 1) * limit, page * limit)),
      total: rows.length,
      page,
      limit,
    };
  }
  async counts(ws: string, userId: string): Promise<InboxCounts> {
    const all = this.state(ws).items,
      active = all.filter((i) => !i.archivedAt);
    const counts: InboxCounts = {
      all: active.length,
      unread: active.filter((i) => !i.readAt).length,
      needsReply: active.filter(
        (i) => !i.repliedAt && !i.resolvedAt && i.replyAllowed,
      ).length,
      unresolved: active.filter((i) => !i.resolvedAt).length,
      resolved: active.filter((i) => !!i.resolvedAt).length,
      assigned: active.filter((i) => i.assignedTo === userId).length,
      archived: all.filter((i) => !!i.archivedAt).length,
      byAccount: {},
      byProvider: {},
    };
    for (const i of active.filter((i) => !i.readAt)) {
      counts.byAccount[i.accountId] = (counts.byAccount[i.accountId] || 0) + 1;
      counts.byProvider[i.provider] = (counts.byProvider[i.provider] || 0) + 1;
    }
    return counts;
  }
  async accounts(): Promise<InboxAccount[]> {
    return ["bluesky", "mastodon", "youtube"].map(
      (p) =>
        ({
          id: `demo-${p}`,
          name: `Aria on ${p}`,
          handle: "Demo account",
          provider: p,
          capability: {
            provider: p,
            implemented: true,
            eventTypes:
              p === "youtube"
                ? ["comment", "reply"]
                : p === "mastodon"
                  ? ["mention", "reply", "direct_message", "reaction", "follow"]
                  : ["mention", "reply", "reaction", "follow"],
            replyTypes:
              p === "youtube"
                ? ["comment", "reply"]
                : p === "mastodon"
                  ? ["mention", "reply", "direct_message"]
                  : ["mention", "reply"],
            status: "available",
            missingScopes: [],
            missingReplyScopes: [],
            maxReplyLength:
              p === "bluesky" ? 300 : p === "mastodon" ? 500 : 10000,
            reason: "Isolated demo data. Replies stay in this browser.",
            syncMethod: "polling",
          },
          lastSyncedAt: new Date().toISOString(),
          nextSyncAt: null,
          syncStatus: "demo",
          syncError: null,
        }) as InboxAccount,
    );
  }
  async members(ws: string, userId: string, name: string) {
    void ws;
    return [{ id: userId, name }];
  }
  async preferences(ws: string) {
    return structuredClone(this.state(ws).preferences);
  }
  async savePreferences(ws: string, prefs: InboxPreferences) {
    this.state(ws).preferences = prefs;
    this.save(ws);
    return prefs;
  }
  async detail(ws: string, id: string): Promise<InboxDetail> {
    const s = this.state(ws),
      item = s.items.find((i) => i.id === id);
    if (!item) throw new Error("Interaction not found.");
    const replies = s.actions.filter((a) => a.itemId === id);
    return structuredClone({
      item,
      messages: [
        {
          id: item.id,
          externalId: item.externalId,
          direction: "incoming" as const,
          text: item.text,
          sender: item.sender,
          occurredAt: item.occurredAt,
        },
        ...replies
          .filter((a) => a.state === "confirmed")
          .map((a) => ({
            id: a.id,
            externalId: a.id,
            direction: "outgoing" as const,
            text: a.text,
            sender: { id: "demo-self", name: "You (demo)" },
            occurredAt: a.createdAt,
          })),
      ],
      actions: replies,
      activity: [],
      contextRefreshedAt: null,
    });
  }
  async change(
    ws: string,
    ids: string[],
    operation: InboxOperation,
    assignedTo?: string | null,
  ) {
    for (const i of this.state(ws).items.filter((i) => ids.includes(i.id))) {
      const now = new Date().toISOString();
      if (operation === "read" || operation === "unread")
        i.readAt = operation === "read" ? now : null;
      if (operation === "resolve" || operation === "reopen")
        i.resolvedAt = operation === "resolve" ? now : null;
      if (operation === "archive" || operation === "unarchive")
        i.archivedAt = operation === "archive" ? now : null;
      if (operation === "assign") i.assignedTo = assignedTo ?? null;
    }
    this.save(ws);
  }
  async reply(
    ws: string,
    id: string,
    text: string,
    key: string,
    userId: string,
  ) {
    const s = this.state(ws),
      item = s.items.find((i) => i.id === id);
    if (!item?.replyAllowed)
      throw new Error("This interaction cannot receive a reply.");
    if (s.actions.some((a) => a.id === key)) return;
    const now = new Date().toISOString();
    s.actions.unshift({
      id: key,
      itemId: id,
      text,
      state: "confirmed",
      createdBy: userId,
      createdAt: now,
      completedAt: now,
      providerMessageId: key,
      nativeUrl: null,
      errorCode: null,
      errorMessage: null,
    });
    item.repliedAt = now;
    item.replyState = "confirmed";
    item.lastActivityAt = now;
    this.save(ws);
  }
  async sync() {
    return "Demo is up to date. No provider was contacted.";
  }
  async refreshThread() {
    /* Demo history is already local. */
  }
}
export const inboxService: InboxService =
  DATA_MODE === "api" ? new ApiInbox() : new DemoInbox();
