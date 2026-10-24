import { afterAll, describe, expect, it } from "vitest";
import { checksumOf, detectMime, simplifyRatio, LocalDiskStorage } from "../src/index.js";
import { rmSync } from "node:fs";

// Minimal valid 1x1 PNG (89 50 4E 47 ...)
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("content sniffing", () => {
  it("identifies PNG", () => {
    expect(detectMime(PNG_1X1)).toEqual({ mime: "image/png", kind: "image" });
  });
  it("identifies JPEG by SOI marker", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    expect(detectMime(jpeg)?.kind).toBe("image");
  });
  it("identifies MP4 by ftyp box", () => {
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(16)]);
    expect(detectMime(mp4)).toEqual({ mime: "video/mp4", kind: "video" });
  });
  it("identifies PDF", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(20)]);
    expect(detectMime(pdf)).toEqual({ mime: "application/pdf", kind: "document" });
  });
  it("returns null for unknown content", () => {
    expect(detectMime(Buffer.alloc(32, 7))).toBeNull();
  });
  it("computes stable checksums", () => {
    expect(checksumOf(PNG_1X1)).toBe(checksumOf(PNG_1X1));
    expect(checksumOf(PNG_1X1)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it("simplifies aspect ratios to known labels", () => {
    expect(simplifyRatio(1080, 1080)).toBe("1:1");
    expect(simplifyRatio(1080, 1350)).toBe("4:5");
    expect(simplifyRatio(1920, 1080)).toBe("16:9");
  });
});

describe("image inspection", () => {
  it("reads real PNG dimensions", async () => {
    const { inspectImage } = await import("../src/index.js");
    const inspection = await inspectImage(PNG_1X1);
    expect(inspection).toEqual({ width: 1, height: 1, aspectRatio: "1:1" });
  });
});

describe("local disk storage", () => {
  const root = `.test-storage-${Date.now()}`;
  const storage = new LocalDiskStorage(root);

  it("saves, reads and deletes content with traversal-safe keys", async () => {
    const { storageKey } = await storage.save("ws1", PNG_1X1, "hero image.png");
    expect(storageKey).toContain("ws1/");
    const readBack = await storage.read(storageKey);
    expect(readBack.equals(PNG_1X1)).toBe(true);

    // Traversal attempts are neutralized to safe filename segments — the
    // resolved path can never escape the storage root.
    const evil = await storage
      .save("ws1", PNG_1X1, "../../evil.png")
      .then((r) => r.storageKey);
    expect(evil.split("/")).not.toContain("..");
    const readEvil = await storage.read(evil);
    expect(readEvil.equals(PNG_1X1)).toBe(true);
    await storage.remove(storageKey);
    await storage.remove(evil);
  });

  it("keys same-content files into the same checksum directory (dedupe happens at DB level)", async () => {
    const a = await storage.save("ws1", PNG_1X1, "a.png");
    const b = await storage.save("ws1", PNG_1X1, "b.png");
    expect(a.storageKey.split("/")[1]).toBe(b.storageKey.split("/")[1]);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
});
