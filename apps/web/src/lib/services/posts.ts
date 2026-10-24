import type {
  Notification,
  Post,
  PostState,
  PublishError,
  PublishTarget,
  TargetState,
  VariantOverride,
} from "../types";
import { NOTIFICATIONS, POSTS, CURRENT_USER_ID } from "../mock/data";
import { DATA_MODE } from "@/lib/api/client";
import { ApiPostsService } from "@/lib/services/backend";
import { Notifier, latency, loadPersisted, persistDebounced } from "./core";
import { accountsService } from "./accounts";
import { notificationsService } from "./notifications";
import { uid } from "../utils";

export interface NewPostInput {
  title: string;
  caption: string;
  link?: string;
  mediaIds: string[];
  selectedAccountIds: string[];
  brandId: string;
  campaign?: string;
  labels?: string[];
  aiDisclosed?: boolean;
  variants?: VariantOverride[];
}

export type PublishMode = "now" | "schedule";

/**
 * Universal posts and the publishing engine.
 *
 * Real implementation: immutable publish snapshots, one publish target per
 * destination with idempotency keys, a durable queue with independent workers
 * per provider, retries with backoff, and status reconciliation via webhooks.
 * The mock implementation simulates the same observable behavior client-side.
 */
export interface PostsService {
  subscribe(fn: () => void): () => void;
  list(): Post[];
  listAsync(): Promise<Post[]>;
  get(id: string): Post | undefined;
  /** Fetch a single post (with detail) — same as get() in the mock. */
  getAsync(id: string): Promise<Post | undefined>;
  createDraft(input: NewPostInput): Promise<Post>;
  /** `selectedAccountIds` replaces the destinations of a draft or scheduled post. */
  updateDraft(id: string, patch: Partial<Post> & { selectedAccountIds?: string[] }): Promise<Post>;
  deletePost(id: string): Promise<void>;
  duplicate(id: string): Promise<Post>;
  publish(id: string): Promise<void>;
  schedule(id: string, whenIso: string): Promise<void>;
  unschedule(id: string): Promise<void>;
  cancelScheduled(id: string): Promise<void>;
  retryTarget(postId: string, targetId: string): Promise<void>;
  cancelTarget(postId: string, targetId: string): Promise<void>;
  /** Continues any targets that were mid-flight when the app loaded. */
  resumeInFlight(): void;
}

const TERMINAL: TargetState[] = ["published", "failed", "canceled", "token_expired", "needs_user_action"];

function computePostState(targets: PublishTarget[]): PostState {
  const states = targets.map((t) => t.state);
  if (states.length === 0) return "draft";
  if (states.every((s) => s === "published")) return "published";
  const inFlight = states.some(
    (s) => !TERMINAL.includes(s) && s !== "pending"
  );
  const pending = states.some((s) => s === "pending");
  const failed = states.some((s) => s === "failed" || s === "token_expired" || s === "needs_user_action");
  const published = states.some((s) => s === "published");
  if (inFlight) return "processing";
  if (failed && published) return "partially_published";
  if (failed && !published && !pending) return "failed";
  if (published && pending) return "partially_published";
  if (pending) return "scheduled";
  return "partially_published";
}

class MockPostsService implements PostsService {
  private notifier = new Notifier();
  private posts: Post[] = loadPersisted<Post[]>("posts") ?? POSTS.map((p) => ({ ...p, targets: p.targets.map((t) => ({ ...t })) }));
  private resumed = false;
  private settledNotified = new Set<string>();

  constructor() {
    // Posts that were already fully delivered before a reload must not
    // raise a second completion notification.
    for (const p of this.posts) {
      if (p.targets.length > 0 && p.targets.every((t) => TERMINAL.includes(t.state))) {
        this.settledNotified.add(p.id);
      }
    }
    this.notifier.subscribe(() => persistDebounced("posts", () => this.posts));
  }

  subscribe(fn: () => void) {
    return this.notifier.subscribe(fn);
  }

  list(): Post[] {
    return this.posts;
  }

  async listAsync(): Promise<Post[]> {
    await latency("slow");
    return this.posts;
  }

  get(id: string): Post | undefined {
    return this.posts.find((p) => p.id === id);
  }

  async getAsync(id: string): Promise<Post | undefined> {
    return this.get(id);
  }

  private emit() {
    this.notifier.emit();
  }

  private updatePost(id: string, fn: (p: Post) => Post) {
    this.posts = this.posts.map((p) => (p.id === id ? fn(p) : p));
    this.emit();
  }

  async createDraft(input: NewPostInput): Promise<Post> {
    await latency("fast");
    const nowIso = new Date().toISOString();
    const post: Post = {
      id: uid("pst"),
      title: input.title,
      caption: input.caption,
      link: input.link,
      mediaIds: input.mediaIds,
      state: "draft",
      brandId: input.brandId,
      authorId: CURRENT_USER_ID,
      campaign: input.campaign,
      labels: input.labels ?? [],
      timezone: "Europe/Berlin",
      createdAt: nowIso,
      updatedAt: nowIso,
      aiDisclosed: input.aiDisclosed,
      variants: input.variants ?? [],
      versions: [],
      targets: input.selectedAccountIds.map((accId) => {
        const account = accountsService.get(accId);
        return {
          id: uid("tgt"),
          accountId: accId,
          provider: account?.provider ?? "facebook",
          state: "pending" as TargetState,
          attempts: 0,
          idempotencyKey: uid("idem"),
        };
      }),
    };
    this.posts = [post, ...this.posts];
    this.emit();
    return post;
  }

  async updateDraft(id: string, patch: Partial<Post>): Promise<Post> {
    await latency("fast");
    let updated!: Post;
    this.updatePost(id, (p) => {
      updated = { ...p, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    });
    return updated;
  }

  async deletePost(id: string): Promise<void> {
    await latency("fast");
    this.posts = this.posts.filter((p) => p.id !== id);
    this.emit();
  }

  async duplicate(id: string): Promise<Post> {
    await latency("fast");
    const src = this.get(id);
    if (!src) throw new Error("Post not found");
    const nowIso = new Date().toISOString();
    const copy: Post = {
      ...src,
      id: uid("pst"),
      title: `${src.title} (copy)`,
      state: "draft",
      createdAt: nowIso,
      updatedAt: nowIso,
      scheduledAt: undefined,
      publishedAt: undefined,
      versions: [],
      targets: src.targets.map((t) => ({
        ...t,
        id: uid("tgt"),
        state: "pending" as TargetState,
        attempts: 0,
        idempotencyKey: uid("idem"),
        publishedAt: undefined,
        remoteUrl: undefined,
        lastError: undefined,
        scheduledAt: undefined,
      })),
    };
    this.posts = [copy, ...this.posts];
    this.emit();
    return copy;
  }

  async schedule(id: string, whenIso: string): Promise<void> {
    await latency("fast");
    this.updatePost(id, (p) => ({
      ...p,
      scheduledAt: whenIso,
      state: "scheduled",
      updatedAt: new Date().toISOString(),
      versions: [
        ...(p.versions ?? []),
        {
          version: (p.versions?.length ?? 0) + 1,
          frozenAt: new Date().toISOString(),
          caption: p.caption,
          mediaIds: p.mediaIds,
          byUserId: CURRENT_USER_ID,
        },
      ],
      targets: p.targets.map((t) => ({ ...t, scheduledAt: whenIso })),
    }));
  }

  async unschedule(id: string): Promise<void> {
    await latency("fast");
    this.updatePost(id, (p) => ({
      ...p,
      scheduledAt: undefined,
      state: "ready",
      updatedAt: new Date().toISOString(),
      targets: p.targets.map((t) => ({ ...t, state: "pending" as TargetState, scheduledAt: undefined })),
    }));
  }

  async cancelScheduled(id: string): Promise<void> {
    await latency("fast");
    this.updatePost(id, (p) => ({
      ...p,
      state: "canceled",
      updatedAt: new Date().toISOString(),
      targets: p.targets.map((t) =>
        t.state === "pending" ? { ...t, state: "canceled" as TargetState } : t
      ),
    }));
  }

  async publish(id: string): Promise<void> {
    const post = this.get(id);
    if (!post) return;
    this.updatePost(id, (p) => ({
      ...p,
      state: "processing",
      updatedAt: new Date().toISOString(),
      versions: [
        ...(p.versions ?? []),
        {
          version: (p.versions?.length ?? 0) + 1,
          frozenAt: new Date().toISOString(),
          caption: p.caption,
          mediaIds: p.mediaIds,
          byUserId: CURRENT_USER_ID,
        },
      ],
    }));
    post.targets.forEach((t, i) => {
      window.setTimeout(() => this.runTarget(post.id, t), i * 380);
    });
  }

  async retryTarget(postId: string, targetId: string): Promise<void> {
    const post = this.get(postId);
    const target = post?.targets.find((t) => t.id === targetId);
    if (!post || !target) return;
    if (target.state === "published") return; // idempotency guard: never double-publish
    this.updatePost(postId, (p) => ({
      ...p,
      state: "processing",
      targets: p.targets.map((t) =>
        t.id === targetId
          ? { ...t, state: "retrying" as TargetState, attempts: t.attempts + 1, lastError: undefined, progress: 0 }
          : t
      ),
    }));
    window.setTimeout(() => this.runTarget(postId, { ...target, attempts: target.attempts + 1 }), 900);
  }

  async cancelTarget(postId: string, targetId: string): Promise<void> {
    this.updatePost(postId, (p) => ({
      ...p,
      targets: p.targets.map((t) =>
        t.id === targetId && !TERMINAL.includes(t.state)
          ? { ...t, state: "canceled" as TargetState }
          : t
      ),
    }));
  }

  resumeInFlight(): void {
    if (this.resumed) return;
    this.resumed = true;
    for (const post of this.posts) {
      if (post.state !== "processing") continue;
      post.targets
        .filter((t) => !TERMINAL.includes(t.state))
        .forEach((t, i) => window.setTimeout(() => this.runTarget(post.id, t), 1200 + i * 500));
    }
  }

  /** Simulates one provider worker executing one publish target. */
  private runTarget(postId: string, target: PublishTarget) {
    const account = accountsService.get(target.accountId);
    const failEarly =
      !account ||
      account.connection === "needs_reauth" ||
      account.connection === "disconnected";

    const setTarget = (patch: Partial<PublishTarget>) => {
      this.updatePost(postId, (p) => ({
        ...p,
        targets: p.targets.map((t) => (t.id === target.id ? { ...t, ...patch } : t)),
      }));
    };

    const finish = (state: TargetState, extra?: Partial<PublishTarget>) => {
      setTarget({ state, ...extra });
      this.settlePost(postId);
    };

    if (failEarly) {
      const error: PublishError = {
        code: "oauth_revoked",
        title: "This account needs to be reconnected",
        message: "Access was revoked, so publishing stopped before anything was sent.",
        hint: "Reconnect the account, then retry this destination.",
        retryable: true,
        technical: "401 · oauth_token_invalid (revoked by user)",
      };
      finish("token_expired", { lastError: error });
      return;
    }

    setTarget({ state: "queued", progress: 0 });
    window.setTimeout(() => setTarget({ state: "uploading_media" }), 500);

    // upload progress
    let pct = 0;
    const uploadTimer = window.setInterval(() => {
      pct = Math.min(100, pct + 12 + Math.random() * 14);
      setTarget({ progress: Math.round(pct) });
      if (pct >= 100) {
        window.clearInterval(uploadTimer);
        window.setTimeout(() => {
          setTarget({ state: "publishing", progress: 20 });
          const pubTimer = window.setInterval(() => {
            const cur = this.get(postId)?.targets.find((t) => t.id === target.id)?.progress ?? 20;
            const next = Math.min(100, cur + 18 + Math.random() * 20);
            setTarget({ progress: Math.round(next) });
            if (next >= 100) {
              window.clearInterval(pubTimer);
              if (target.provider === "tiktok" || target.provider === "youtube") {
                setTarget({ state: "provider_processing", progress: undefined });
                window.setTimeout(() => {
                  finish("published", { publishedAt: new Date().toISOString() });
                  this.notifySettled(postId);
                }, target.provider === "youtube" ? 2600 : 1800);
              } else {
                finish("published", { publishedAt: new Date().toISOString() });
                window.setTimeout(() => this.notifySettled(postId), 600);
              }
            }
          }, 260);
        }, 350);
      }
    }, 240);
  }



  private settlePost(postId: string) {
    this.updatePost(postId, (p) => ({ ...p, state: computePostState(p.targets) }));
  }

  private notifySettled(postId: string) {
    const post = this.get(postId);
    if (!post) return;
    const settled = post.targets.every((t) => TERMINAL.includes(t.state));
    if (!settled || this.settledNotified.has(postId)) return;
    this.settledNotified.add(postId);
    const failed = post.targets.filter((t) => t.state === "failed" || t.state === "token_expired");
    const published = post.targets.filter((t) => t.state === "published");
    const n: Notification =
      failed.length > 0
        ? {
            id: uid("ntf"),
            type: "post_failed",
            title: `“${post.title}” needs attention`,
            body:
              failed.length === post.targets.length
                ? "All destinations failed. Open the post to see what happened."
                : `${published.length} published · ${failed.length} failed. Successful destinations are not affected.`,
            createdAt: new Date().toISOString(),
            read: false,
            severity: failed.length === post.targets.length ? "error" : "warning",
            postId: post.id,
          }
        : {
            id: uid("ntf"),
            type: "post_published",
            title: `“${post.title}” published`,
            body: `Published to ${published.length} destination${published.length === 1 ? "" : "s"}.`,
            createdAt: new Date().toISOString(),
            read: false,
            severity: "success",
            postId: post.id,
          };
    notificationsService.push(n);
  }
}

export const postsService: PostsService =
  DATA_MODE === "api" ? new ApiPostsService() : new MockPostsService();
