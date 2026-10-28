import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  mode: "mock",
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({
  get DATA_MODE() {
    return api.mode;
  },
  apiGet: api.get,
  apiPost: api.post,
  apiPut: api.put,
  apiPatch: api.patch,
  apiDelete: api.del,
}));
beforeEach(() => {
  vi.resetModules();
  for (const method of [api.get, api.post, api.put, api.patch, api.del])
    method.mockReset();
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
describe("feed demo and real service boundaries", () => {
  it("offers explicitly labelled mixed samples with stable duplicate-free pagination and no network calls", async () => {
    api.mode = "mock";
    const { feedService } = await import("../src/lib/services/feed");
    const a = await feedService.list("w", "u", { limit: 5 });
    expect(new Set(a.items.map((i) => i.provider)).size).toBeGreaterThan(1);
    expect(a.items.every((i) => i.sample)).toBe(true);
    const b = await feedService.list("w", "u", {
      limit: 5,
      cursor: a.nextCursor!,
    });
    expect(new Set([...a.items, ...b.items].map((i) => i.id)).size).toBe(10);
    expect(
      (await feedService.list("w", "u", { limit: 5, cursor: a.nextCursor! }))
        .items,
    ).toEqual(b.items);
    expect(api.get).not.toHaveBeenCalled();
  });
  it("persists saves, follows, preferences and hidden content under the correct user and workspace", async () => {
    api.mode = "mock";
    const { feedService: s } = await import("../src/lib/services/feed");
    const item = (await s.list("w", "alice", {})).items[0];
    await s.save("w", "alice", item, true);
    await s.follow("w", "alice", item, true);
    expect(
      (await s.list("w", "alice", { view: "saved" })).items.map((i) => i.id),
    ).toContain(item.id);
    expect((await s.list("w", "bob", { view: "saved" })).items).toHaveLength(0);
    expect(
      (await s.list("other", "alice", { view: "saved" })).items,
    ).toHaveLength(0);
    await s.hide("w", "alice", item.id);
    expect((await s.list("w", "alice", { view: "saved" })).items).toHaveLength(
      0,
    );
    await s.resetPreferences("w", "alice");
    vi.resetModules();
    const reloaded = (await import("../src/lib/services/feed")).feedService;
    expect(
      (await reloaded.list("w", "alice", { view: "saved" })).items[0].saved,
    ).toBe(true);
    expect(
      (await reloaded.list("w", "alice", { view: "following" })).items.length,
    ).toBeGreaterThan(0);
  });
  it("filters video-only, posts, own accounts and topics in demo mode", async () => {
    api.mode = "mock";
    const s = (await import("../src/lib/services/feed")).feedService;
    expect(
      (await s.list("w", "u", { view: "videos" })).items.every(
        (i) => i.contentType === "video",
      ),
    ).toBe(true);
    expect(
      (await s.list("w", "u", { view: "posts" })).items.every(
        (i) => i.contentType !== "video",
      ),
    ).toBe(true);
    expect(
      (await s.list("w", "u", { view: "my_accounts" })).items.every(
        (i) => i.sourceType === "account",
      ),
    ).toBe(true);
    expect(
      (
        await s.list("w", "u", { provider: "youtube", topic: "Education" })
      ).items.every(
        (i) => i.provider === "youtube" && i.topics.includes("Education"),
      ),
    ).toBe(true);
  });
  it("uses only the server in API mode and propagates failure without sample fallback", async () => {
    api.mode = "api";
    api.get.mockRejectedValue(new Error("Feed unavailable"));
    const s = (await import("../src/lib/services/feed")).feedService;
    await expect(s.list("real", "u", {})).rejects.toThrow("Feed unavailable");
    expect(api.get).toHaveBeenCalledWith("/v1/workspaces/real/feed?");
    expect(api.post).not.toHaveBeenCalled();
  });
});
