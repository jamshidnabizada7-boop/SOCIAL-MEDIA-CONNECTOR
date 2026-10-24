"use client";

/**
 * API-backed media service: multipart upload to the API (content sniffing,
 * checksum dedupe and inspection happen server-side), list, alt-text updates
 * and deletion. Raw content is served auth-scoped from the API — MediaThumb
 * renders it directly via <img> (same-site cookies apply).
 */

import type { MediaAsset } from "@/lib/types";
import type { MediaService } from "@/lib/services/media";
import { API_URL, apiDelete, apiGet, apiPatch, apiUpload } from "@/lib/api/client";

interface ApiMediaRow {
  id: string;
  kind: MediaAsset["kind"];
  filename: string;
  mime: string;
  detectedMime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  durationSec?: number | null;
  codec?: string | null;
  audioCodec?: string | null;
  fps?: number | null;
  checksum: string;
  altText?: string | null;
  hue?: number;
  tags?: string[];
  status: MediaAsset["status"];
  createdAt: string;
  url?: string | null;
}

export class ApiMediaService implements MediaService {
  private cache: MediaAsset[] = [];
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private map(row: ApiMediaRow): MediaAsset {
    return {
      id: row.id,
      kind: row.kind,
      filename: row.filename,
      bytes: row.bytes,
      mime: row.mime,
      detectedMime: row.detectedMime,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      aspectRatio: row.aspectRatio ?? undefined,
      durationSec: row.durationSec ?? undefined,
      codec: row.codec ?? undefined,
      audioCodec: row.audioCodec ?? undefined,
      fps: row.fps ?? undefined,
      checksum: row.checksum,
      altText: row.altText ?? undefined,
      hue: row.hue ?? 200,
      tags: row.tags ?? [],
      status: row.status,
      createdAt: row.createdAt,
      usedInCount: 0,
      url: row.url ?? undefined,
    };
  }

  async refresh(): Promise<void> {
    try {
      const res = await apiGet<{ media: ApiMediaRow[] }>("/v1/workspaces/current/media");
      this.cache = res.media.map((m) => this.map(m));
      this.emit();
    } catch {
      /* keep last good cache */
    }
  }

  list(): MediaAsset[] {
    return this.cache;
  }

  async listAsync(): Promise<MediaAsset[]> {
    await this.refresh();
    return this.cache;
  }

  get(id: string): MediaAsset | undefined {
    return this.cache.find((m) => m.id === id);
  }

  async upload(file: File, onProgress?: (pct: number) => void): Promise<MediaAsset> {
    // Real upload; a light fake progress until the response lands (browser
    // fetch has no upload progress without XHR — swap if granularity matters).
    onProgress?.(30);
    const res = await apiUpload<{ media: ApiMediaRow; deduplicated: boolean }>(
      "/v1/workspaces/current/media/upload",
      file
    );
    onProgress?.(100);
    const mapped = this.map(res.media);
    if (!this.cache.some((m) => m.id === mapped.id)) {
      this.cache = [mapped, ...this.cache];
      this.emit();
    }
    return mapped;
  }

  async update(id: string, patch: Partial<Pick<MediaAsset, "altText" | "tags">>): Promise<MediaAsset> {
    const res = await apiPatch<{ media: ApiMediaRow }>(
      `/v1/workspaces/current/media/${id}`,
      { altText: patch.altText }
    );
    const mapped = this.map(res.media);
    this.cache = this.cache.map((m) => (m.id === id ? mapped : m));
    this.emit();
    return mapped;
  }

  async remove(id: string): Promise<void> {
    await apiDelete(`/v1/workspaces/current/media/${id}`);
    this.cache = this.cache.filter((m) => m.id !== id);
    this.emit();
  }

  /** Derivatives arrive with the media-engine roadmap. */
  async derive(): Promise<MediaAsset> {
    throw new Error("Derivatives arrive with the media-engine roadmap.");
  }
}
