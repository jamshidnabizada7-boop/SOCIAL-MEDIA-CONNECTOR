import type { MediaAsset } from "../types";
import { MEDIA } from "../mock/data";
import { DATA_MODE } from "@/lib/api/client";
import { ApiMediaService } from "@/lib/services/media-api";
import { Notifier, latency, loadPersisted, persistDebounced } from "./core";
import { uid } from "../utils";

export interface MediaService {
  subscribe(fn: () => void): () => void;
  list(): MediaAsset[];
  listAsync(): Promise<MediaAsset[]>;
  get(id: string): MediaAsset | undefined;
  /**
   * Simulated signed upload → object storage → inspection pipeline.
   * Reports progress; extracts real image dimensions where the browser allows.
   */
  upload(file: File, onProgress?: (pct: number) => void): Promise<MediaAsset>;
  update(id: string, patch: Partial<Pick<MediaAsset, "altText" | "tags">>): Promise<MediaAsset>;
  remove(id: string): Promise<void>;
  /**
   * Creates a derived asset (crop, compression, trim) without touching the
   * original upload — the media engine's core contract.
   */
  derive(
    id: string,
    change: { aspect?: string; note?: string; scaleBytesTo?: number; trimToSec?: number }
  ): Promise<MediaAsset>;
}

async function inspect(file: File): Promise<{ width?: number; height?: number; durationSec?: number; mime: string }> {
  const kind: MediaAsset["kind"] = file.type.startsWith("video/")
    ? "video"
    : file.type.startsWith("image/")
      ? "image"
      : "document";

  if (kind === "image") {
    try {
      const bitmap = await createImageBitmap(file);
      const result = { width: bitmap.width, height: bitmap.height, mime: file.type || "image/*" };
      bitmap.close();
      return result;
    } catch {
      return { mime: file.type || "image/*" };
    }
  }
  if (kind === "video") {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      const meta = await new Promise<{ width?: number; height?: number; durationSec?: number }>((resolve) => {
        video.onloadedmetadata = () =>
          resolve({ width: video.videoWidth, height: video.videoHeight, durationSec: Math.round(video.duration) });
        video.onerror = () => resolve({});
        window.setTimeout(() => resolve({}), 3000);
      });
      URL.revokeObjectURL(url);
      return { ...meta, mime: file.type || "video/mp4" };
    } catch {
      return { mime: file.type || "video/mp4" };
    }
  }
  return { mime: file.type || "application/octet-stream" };
}

class MockMediaService implements MediaService {
  private notifier = new Notifier();
  private assets: MediaAsset[] = loadPersisted<MediaAsset[]>("media") ?? MEDIA.map((m) => ({ ...m }));

  constructor() {
    this.notifier.subscribe(() => persistDebounced("media", () => this.assets));
  }

  subscribe(fn: () => void) {
    return this.notifier.subscribe(fn);
  }

  list(): MediaAsset[] {
    return [...this.assets].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  async listAsync(): Promise<MediaAsset[]> {
    await latency("slow");
    return this.list();
  }

  get(id: string): MediaAsset | undefined {
    return this.assets.find((m) => m.id === id);
  }

  async upload(file: File, onProgress?: (pct: number) => void): Promise<MediaAsset> {
    const kind: MediaAsset["kind"] = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("image/")
        ? "image"
        : "document";
    for (let p = 0; p <= 100; p += 100 / 12) {
      onProgress?.(Math.min(100, Math.round(p)));
      await new Promise((r) => setTimeout(r, 90));
    }
    await latency("slow"); // "inspection"
    const meta = await inspect(file);
    const asset: MediaAsset = {
      id: uid("med"),
      kind,
      filename: file.name,
      bytes: file.size,
      mime: file.type || "application/octet-stream",
      detectedMime: meta.mime,
      width: meta.width,
      height: meta.height,
      aspectRatio: meta.width && meta.height ? `${meta.width}:${meta.height}` : undefined,
      durationSec: meta.durationSec,
      codec: kind === "video" ? "h264" : undefined,
      audioCodec: kind === "video" ? "aac" : undefined,
      fps: kind === "video" ? 30 : undefined,
      checksum: `sha256:${Math.random().toString(16).slice(2, 10)}`,
      hue: Math.floor(Math.random() * 360),
      tags: [],
      status: "ready",
      createdAt: new Date().toISOString(),
      usedInCount: 0,
    };
    this.assets = [asset, ...this.assets];
    this.notifier.emit();
    return asset;
  }

  async update(id: string, patch: Partial<Pick<MediaAsset, "altText" | "tags">>): Promise<MediaAsset> {
    await latency("fast");
    let updated!: MediaAsset;
    this.assets = this.assets.map((m) => {
      if (m.id !== id) return m;
      updated = { ...m, ...patch };
      return updated;
    });
    this.notifier.emit();
    return updated;
  }

  async remove(id: string): Promise<void> {
    await latency("fast");
    this.assets = this.assets.filter((m) => m.id !== id);
    this.notifier.emit();
  }

  async derive(
    id: string,
    change: { aspect?: string; note?: string; scaleBytesTo?: number; trimToSec?: number }
  ): Promise<MediaAsset> {
    await new Promise((r) => setTimeout(r, 1100)); // simulated transcode
    const src = this.get(id);
    if (!src) throw new Error("Media not found");
    const derived: MediaAsset = {
      ...src,
      id: uid("med"),
      filename: src.filename.replace(/(\.\w+)?$/, `-${change.aspect ? change.aspect.replace(":", "x") : change.note === "compressed" ? "compressed" : "trim"}$1`),
      bytes: change.scaleBytesTo ?? Math.round(src.bytes * (change.aspect ? 0.72 : 1)),
      aspectRatio: change.aspect ?? src.aspectRatio,
      durationSec: change.trimToSec ?? src.durationSec,
      tags: [...src.tags, "derived"],
      altText: src.altText,
      createdAt: new Date().toISOString(),
      usedInCount: 0,
      hue: src.hue,
    };
    this.assets = [derived, ...this.assets];
    this.notifier.emit();
    return derived;
  }
}

export const mediaService: MediaService =
  DATA_MODE === "api" ? new ApiMediaService() : new MockMediaService();
