import { afterEach, describe, expect, it, vi } from "vitest";
import { instagramAdapter } from "../src/adapters/instagram.js";
import { threadsAdapter } from "../src/adapters/threads.js";
import type { AdapterAccountContext, AdapterPublishInput } from "../src/adapters/contract.js";

const ctx: AdapterAccountContext = { externalAccountId: "account-1", accessToken: "fixture-token", scopes: [], log: () => {} };
const image = { mediaId: "img", kind: "image" as const, filename: "image.jpg", bytes: 100, mime: "image/jpeg", publicUrl: "https://media.example/image.jpg", altText: "A mountain" };
const video = { mediaId: "vid", kind: "video" as const, filename: "video.mp4", bytes: 100, mime: "video/mp4", publicUrl: "https://media.example/video.mp4" };
const input = (media = [image] as AdapterPublishInput["content"]["media"]): AdapterPublishInput => ({ content: { caption: "A fixture post", media }, settings: {} });
type Call = { url: URL; method: string; body: URLSearchParams };

function fixture(provider: "instagram" | "threads", opts: {
  statuses?: string[]; statusHttp?: number; invalidContainer?: boolean; invalidPublish?: boolean; permalinkHttp?: number;
} = {}) {
  const calls: Call[] = [];
  let containers = 0;
  let statusCalls = 0;
  const publishPath = provider === "instagram" ? "media_publish" : "threads_publish";
  const createPath = provider === "instagram" ? "media" : "threads";
  const statusField = provider === "instagram" ? "status_code" : "status";
  vi.stubGlobal("fetch", vi.fn(async (raw: string, init?: RequestInit) => {
    const url = new URL(raw);
    const method = init?.method ?? "GET";
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, method, body });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-token");
    expect(url.searchParams.has("access_token")).toBe(false);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (method === "POST") {
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded");
      if (url.pathname.endsWith(`/${publishPath}`)) return json(opts.invalidPublish ? {} : { id: "post-1" });
      if (url.pathname.endsWith(`/${createPath}`)) return json(opts.invalidContainer ? { creationId: "wrong-wire-format" } : { id: `container-${++containers}` });
    }
    if (method === "GET" && url.searchParams.get("fields") === statusField) {
      const statuses = opts.statuses ?? ["FINISHED"];
      const status = statuses[Math.min(statusCalls++, statuses.length - 1)];
      return json({ [statusField]: status }, opts.statusHttp ?? 200);
    }
    if (method === "GET" && url.searchParams.get("fields") === "permalink") return json({ permalink: `https://www.${provider === "threads" ? "threads.com/@fixture/post" : "instagram.com/p"}/real-shortcode/` }, opts.permalinkHttp ?? 200);
    throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
  }));
  return {
    calls,
    creates: () => calls.filter(c => c.method === "POST" && c.url.pathname.endsWith(`/${createPath}`)),
    publishes: () => calls.filter(c => c.method === "POST" && c.url.pathname.endsWith(`/${publishPath}`)),
    statuses: () => calls.filter(c => c.method === "GET" && c.url.searchParams.get("fields") === statusField),
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Meta publishing against actual response shapes", () => {
  it("publishes an Instagram photo using Meta's id/status_code and real permalink", async () => {
    const f = fixture("instagram");
    const result = await instagramAdapter.createPost(input(), ctx);
    expect(f.creates()[0].body.has("media_type")).toBe(false);
    expect(f.creates()[0].body.get("image_url")).toBe(image.publicUrl);
    expect(f.creates()[0].body.get("alt_text")).toBe(image.altText);
    expect(f.publishes()[0].body.get("creation_id")).toBe("container-1");
    expect(result).toEqual({ providerPostId: "post-1", permalink: "https://www.instagram.com/p/real-shortcode/" });
  });

  it("creates Instagram carousel children before sending their ids with the parent", async () => {
    const f = fixture("instagram");
    await instagramAdapter.createPost(input([image, video]), ctx);
    const [first, second, parent] = f.creates();
    expect(first.body.get("is_carousel_item")).toBe("true");
    expect(second.body.get("is_carousel_item")).toBe("true");
    expect(second.body.get("media_type")).toBe("VIDEO");
    expect(parent.body.get("media_type")).toBe("CAROUSEL");
    expect(parent.body.get("children")).toBe("container-1,container-2");
    expect(f.calls.indexOf(parent)).toBeGreaterThan(f.calls.indexOf(f.statuses()[1]));
    expect(f.publishes()).toHaveLength(1);
    expect(f.publishes()[0].body.get("creation_id")).toBe("container-3");
    expect(f.calls.filter(c => c.method === "POST")).toHaveLength(4);
  });

  it("publishes Threads text using Meta's id/status and actual permalink", async () => {
    const f = fixture("threads");
    const result = await threadsAdapter.createPost(input([]), ctx);
    expect(f.creates()[0].body.get("media_type")).toBe("TEXT");
    expect(f.creates()[0].body.get("text")).toBe("A fixture post");
    expect(f.publishes()[0].body.get("creation_id")).toBe("container-1");
    expect(result.permalink).toBe("https://www.threads.com/@fixture/post/real-shortcode/");
  });

  it("keeps both attachments and alt text when publishing a Threads carousel", async () => {
    const f = fixture("threads");
    await threadsAdapter.createPost(input([image, video]), ctx);
    const [first, second, parent] = f.creates();
    expect(first.body.get("image_url")).toBe(image.publicUrl);
    expect(first.body.get("alt_text")).toBe("A mountain");
    expect(first.body.has("text")).toBe(false);
    expect(second.body.get("video_url")).toBe(video.publicUrl);
    expect(second.body.get("is_carousel_item")).toBe("true");
    expect(parent.body.get("media_type")).toBe("CAROUSEL");
    expect(parent.body.get("children")).toBe("container-1,container-2");
    expect(parent.body.has("image_url")).toBe(false);
    expect(parent.body.has("video_url")).toBe(false);
    expect(f.publishes()[0].body.get("creation_id")).toBe("container-3");
  });

  for (const [provider, adapter] of [["instagram", instagramAdapter], ["threads", threadsAdapter]] as const) {
    it(`${provider}: stops on processing failure and never publishes`, async () => {
      const f = fixture(provider, { statuses: ["ERROR"] });
      await expect(adapter.createPost(input(), ctx)).rejects.toMatchObject({ code: "media_processing_failed" });
      expect(f.publishes()).toHaveLength(0);
    });
    it(`${provider}: propagates authentication failure during processing checks`, async () => {
      const f = fixture(provider, { statusHttp: 401 });
      await expect(adapter.createPost(input(), ctx)).rejects.toMatchObject({ status: 401 });
      expect(f.publishes()).toHaveLength(0);
    });
    it(`${provider}: waits for readiness and never publishes an unfinished container`, async () => {
      vi.useFakeTimers();
      const f = fixture(provider, { statuses: ["IN_PROGRESS"] });
      const finished = expect(adapter.createPost(input(), ctx)).rejects.toMatchObject({ code: "media_processing_timeout" });
      await vi.advanceTimersByTimeAsync(240_000);
      await finished;
      expect(f.statuses()).toHaveLength(5);
      expect(f.publishes()).toHaveLength(0);
    });
    it(`${provider}: rejects a missing container id before publishing`, async () => {
      const f = fixture(provider, { invalidContainer: true });
      await expect(adapter.createPost(input(), ctx)).rejects.toThrow("container ID");
      expect(f.publishes()).toHaveLength(0);
    });
    it(`${provider}: retains success if the optional permalink lookup fails`, async () => {
      const f = fixture(provider, { permalinkHttp: 503 });
      expect(await adapter.createPost(input(), ctx)).toEqual({ providerPostId: "post-1", permalink: undefined });
      expect(f.publishes()).toHaveLength(1);
    });
    it(`${provider}: treats a missing published id as an uncertain outcome`, async () => {
      const f = fixture(provider, { invalidPublish: true });
      await expect(adapter.createPost(input(), ctx)).rejects.toMatchObject({ status: 0 });
      expect(f.publishes()).toHaveLength(1);
    });
  }

  it("waits a full minute before checking pending media again", async () => {
    vi.useFakeTimers();
    const f = fixture("instagram", { statuses: ["IN_PROGRESS", "FINISHED"] });
    const publishing = instagramAdapter.createPost(input(), ctx);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.statuses()).toHaveLength(1);
    expect(f.publishes()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect((await publishing).providerPostId).toBe("post-1");
  });
});
