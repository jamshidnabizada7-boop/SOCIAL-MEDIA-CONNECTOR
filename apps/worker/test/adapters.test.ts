import { beforeAll, describe, expect, it } from "vitest";
import { blueskyAdapter } from "../src/adapters/bluesky.js";
import { mastodonAdapter } from "../src/adapters/mastodon.js";
import { getAdapter, usesRealCredentials } from "../src/adapters/registry.js";

const baseInput = (caption: string, media: Array<{ kind: "image" | "video" | "document"; filename: string }> = []) => ({
  content: { caption, media: media.map((m) => ({ ...m, mediaId: "m1", bytes: 1000 })) },
  settings: {},
});

describe("bluesky adapter", () => {
  beforeAll(() => {
    delete process.env.ARIA_ADAPTER_MODE;
  });
  it("is selected by the registry and uses real credentials", () => {
    expect(getAdapter("bluesky")).toBe(blueskyAdapter);
    expect(usesRealCredentials("bluesky")).toBe(true);
  });

  it("accepts a 300-grapheme caption", () => {
    expect(blueskyAdapter.validateContent(baseInput("a".repeat(300)))).toBeNull();
  });

  it("rejects a 301-grapheme caption with a translated error", () => {
    const err = blueskyAdapter.validateContent(baseInput("a".repeat(301)));
    expect(err?.code).toBe("caption_too_long");
    expect(err?.retryable).toBe(false);
  });

  it("rejects video with an honest Phase 3 message", () => {
    const err = blueskyAdapter.validateContent(baseInput("hello", [{ kind: "video", filename: "v.mp4" }]));
    expect(err?.code).toBe("video_not_yet_supported");
    expect(err?.retryable).toBe(false);
  });

  it("accepts images with loaded content (media storage live)", () => {
    const input = {
      content: {
        caption: "hello",
        media: [{ mediaId: "m1", kind: "image" as const, filename: "i.jpg", bytes: 1000, mime: "image/jpeg", data: new Uint8Array(10) }],
      },
      settings: {},
    };
    expect(blueskyAdapter.validateContent(input)).toBeNull();
  });

  it("rejects images whose content failed to load", () => {
    const err = blueskyAdapter.validateContent(baseInput("hello", [{ kind: "image", filename: "i.jpg" }]));
    expect(err?.code).toBe("media_content_missing");
  });

  it("rejects oversized images with the network limit", () => {
    const input = {
      content: {
        caption: "hello",
        media: [{ mediaId: "m1", kind: "image" as const, filename: "big.jpg", bytes: 5_000_000, mime: "image/jpeg", data: new Uint8Array(5_000_000) }],
      },
      settings: {},
    };
    const err = blueskyAdapter.validateContent(input);
    expect(err?.code).toBe("image_too_large");
  });
});


describe("mastodon adapter", () => {
  it("is selected by the registry and uses real credentials", () => {
    expect(getAdapter("mastodon")).toBe(mastodonAdapter);
    expect(usesRealCredentials("mastodon")).toBe(true);
  });

  it("accepts images with loaded content, rejects unloaded", () => {
    const ok = {
      content: {
        caption: "hello",
        media: [{ mediaId: "m1", kind: "image" as const, filename: "i.png", bytes: 1000, mime: "image/png", data: new Uint8Array(10) }],
      },
      settings: {},
    };
    expect(mastodonAdapter.validateContent(ok)).toBeNull();
    const err = mastodonAdapter.validateContent(baseInput("hello", [{ kind: "image", filename: "i.png" }]));
    expect(err?.code).toBe("media_content_missing");
    expect(err?.retryable).toBe(false);
  });

  it("accepts a text-only status", () => {
    expect(mastodonAdapter.validateContent(baseInput("Hello fediverse"))).toBeNull();
  });

  it("registry serves a real adapter for every known provider", () => {
    const adapter = getAdapter("instagram");
    expect(adapter.id).toBe("instagram");
    expect(usesRealCredentials("instagram")).toBe(true);
  });

  it("mock mode routes everything through the mock adapter", () => {
    process.env.ARIA_ADAPTER_MODE = "mock";
    try {
      const adapter = getAdapter("instagram");
      expect(adapter.id).toBe("instagram");
      expect(usesRealCredentials("instagram")).toBe(true); // credentials flag is mode-independent
      expect(adapter.uploadMedia).toBeDefined();
    } finally {
      delete process.env.ARIA_ADAPTER_MODE;
    }
  });
});
