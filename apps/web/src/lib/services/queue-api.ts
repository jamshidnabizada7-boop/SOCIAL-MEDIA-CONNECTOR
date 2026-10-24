"use client";

/**
 * API-backed queue service: recurring posting windows (plan §22) plus the
 * add-to-queue scheduling action. Works against /v1/workspaces/current/queue.
 */

import type { QueueSlot } from "@/lib/types";
import type { QueueService } from "@/lib/services/queue";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";

export class ApiQueueService implements QueueService {
  private cache: QueueSlot[] = [];
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

  private map(row: { id: string; dayOfWeek: number; time: string; providerIds: string[]; enabled: boolean }): QueueSlot {
    return {
      id: row.id,
      dayOfWeek: row.dayOfWeek,
      time: row.time,
      providerIds: row.providerIds as QueueSlot["providerIds"],
      enabled: row.enabled,
    };
  }

  async refresh(): Promise<void> {
    try {
      const res = await apiGet<{ slots: Array<{ id: string; dayOfWeek: number; time: string; providerIds: string[]; enabled: boolean }> }>(
        "/v1/workspaces/current/queue/slots"
      );
      this.cache = res.slots.map((s) => this.map(s));
      this.emit();
    } catch {
      /* keep last good cache */
    }
  }

  slots(): QueueSlot[] {
    return this.cache;
  }

  async listAsync(): Promise<QueueSlot[]> {
    await this.refresh();
    return this.cache;
  }

  async addSlot(slot: Omit<QueueSlot, "id">): Promise<void> {
    await apiPost("/v1/workspaces/current/queue/slots", slot);
    await this.refresh();
  }

  async updateSlot(id: string, patch: Partial<QueueSlot>): Promise<void> {
    await apiPatch(`/v1/workspaces/current/queue/slots/${id}`, {
      ...(patch.dayOfWeek !== undefined ? { dayOfWeek: patch.dayOfWeek } : {}),
      ...(patch.time !== undefined ? { time: patch.time } : {}),
      ...(patch.providerIds !== undefined ? { providerIds: patch.providerIds } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    await this.refresh();
  }

  async removeSlot(id: string): Promise<void> {
    await apiDelete(`/v1/workspaces/current/queue/slots/${id}`);
    this.cache = this.cache.filter((s) => s.id !== id);
    this.emit();
  }
}
