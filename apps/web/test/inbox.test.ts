import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  mode: "mock",
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({
  get DATA_MODE() {
    return api.mode;
  },
  apiGet: api.get,
  apiPost: api.post,
  apiPatch: api.patch,
}));
beforeEach(() => {
  vi.resetModules();
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
describe("inbox service modes", () => {
  it("keeps demo state isolated per workspace and persists handling/replies/preferences", async () => {
    api.mode = "mock";
    const { inboxService: demo } = await import("../src/lib/services/inbox");
    const initial = await demo.list("workspace-a", {}, "user-a");
    expect(initial.total).toBe(4);
    const item = initial.items[0];
    await demo.change("workspace-a", [item.id], "read");
    await demo.change("workspace-a", [item.id], "assign", "user-a");
    await demo.reply(
      "workspace-a",
      item.id,
      "Demo reply",
      "same-key",
      "user-a",
    );
    await demo.reply(
      "workspace-a",
      item.id,
      "Demo reply",
      "same-key",
      "user-a",
    );
    expect((await demo.detail("workspace-a", item.id)).actions).toHaveLength(1);
    expect(
      (await demo.detail("workspace-a", item.id)).item.resolvedAt,
    ).toBeNull();
    expect(
      (await demo.list("workspace-a", { view: "assigned" }, "user-a")).total,
    ).toBe(1);
    expect((await demo.detail("workspace-b", item.id)).item.readAt).toBeNull();
    await demo.savePreferences("workspace-a", {
      enabledTypes: ["mention"],
      priorityTypes: [],
    });
    vi.resetModules();
    const reloaded = (await import("../src/lib/services/inbox")).inboxService;
    expect(
      (await reloaded.detail("workspace-a", item.id)).item.repliedAt,
    ).toBeTruthy();
    expect((await reloaded.preferences("workspace-a")).enabledTypes).toEqual([
      "mention",
    ]);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
  it("supports demo filters, pagination and archive independently of resolution", async () => {
    api.mode = "mock";
    const demo = (await import("../src/lib/services/inbox")).inboxService;
    expect(
      (await demo.list("w", { types: ["direct_message"] }, "u")).total,
    ).toBe(1);
    expect(
      (await demo.list("w", { search: "walkthrough", limit: 1 }, "u")).items[0]
        .provider,
    ).toBe("youtube");
    const item = (await demo.list("w", { limit: 1, page: 2 }, "u")).items[0];
    await demo.change("w", [item.id], "archive");
    expect((await demo.list("w", { view: "archived" }, "u")).total).toBe(1);
    expect((await demo.detail("w", item.id)).item.resolvedAt).toBeNull();
  });
  it("does not fall back to demo data on API failure", async () => {
    api.mode = "api";
    api.get.mockRejectedValue(new Error("API unavailable"));
    const service = (await import("../src/lib/services/inbox")).inboxService;
    await expect(service.list("w", {}, "u")).rejects.toThrow("API unavailable");
    await expect(service.accounts("w")).rejects.toThrow("API unavailable");
  });
  it("sends API filters and idempotency keys to the authenticated workspace", async () => {
    api.mode = "api";
    api.get.mockResolvedValue({ items: [], total: 0 });
    api.post.mockResolvedValue({});
    const service = (await import("../src/lib/services/inbox")).inboxService;
    await service.list(
      "workspace",
      {
        types: ["comment", "reply"],
        accountIds: ["one", "two"],
        search: "a & b",
        page: 2,
      },
      "user",
    );
    const query = new URL(api.get.mock.calls[0][0], "https://fixture.test")
      .searchParams;
    expect(query.get("types")).toBe("comment,reply");
    expect(query.get("search")).toBe("a & b");
    expect(query.get("page")).toBe("2");
    await service.reply("workspace", "item", "Reply", "key", "user");
    expect(api.post).toHaveBeenCalledWith(
      "/v1/workspaces/workspace/inbox/item/reply",
      { text: "Reply", idempotencyKey: "key" },
    );
  });
});
