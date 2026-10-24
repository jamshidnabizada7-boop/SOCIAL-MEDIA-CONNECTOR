import type { QueueSlot } from "../types";
import { QUEUE_SLOTS } from "../mock/data";
import { DATA_MODE } from "@/lib/api/client";
import { ApiQueueService } from "@/lib/services/queue-api";
import { Notifier, latency, loadPersisted, persistDebounced } from "./core";
import { uid } from "../utils";

export interface QueueService {
  subscribe(fn: () => void): () => void;
  slots(): QueueSlot[];
  listAsync(): Promise<QueueSlot[]>;
  addSlot(slot: Omit<QueueSlot, "id">): Promise<void>;
  updateSlot(id: string, patch: Partial<QueueSlot>): Promise<void>;
  removeSlot(id: string): Promise<void>;
}

/**
 * Recurring posting windows. When a post is added to the queue it is assigned
 * to the next open slot for its selected channels.
 */
class MockQueueService implements QueueService {
  private notifier = new Notifier();
  private slotList: QueueSlot[] = loadPersisted<QueueSlot[]>("queue") ?? QUEUE_SLOTS.map((s) => ({ ...s }));

  constructor() {
    this.notifier.subscribe(() => persistDebounced("queue", () => this.slotList));
  }

  subscribe(fn: () => void) {
    return this.notifier.subscribe(fn);
  }

  slots(): QueueSlot[] {
    return [...this.slotList].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time));
  }

  async listAsync(): Promise<QueueSlot[]> {
    await latency("normal");
    return this.slotList;
  }

  async addSlot(slot: Omit<QueueSlot, "id">): Promise<void> {
    await latency("fast");
    this.slotList = [...this.slotList, { ...slot, id: uid("qs") }];
    this.notifier.emit();
  }

  async updateSlot(id: string, patch: Partial<QueueSlot>): Promise<void> {
    await latency("fast");
    this.slotList = this.slotList.map((s) => (s.id === id ? { ...s, ...patch } : s));
    this.notifier.emit();
  }

  async removeSlot(id: string): Promise<void> {
    await latency("fast");
    this.slotList = this.slotList.filter((s) => s.id !== id);
    this.notifier.emit();
  }
}

export const queueService: QueueService =
  DATA_MODE === "api" ? new ApiQueueService() : new MockQueueService();
