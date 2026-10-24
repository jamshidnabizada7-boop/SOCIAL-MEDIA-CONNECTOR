import type { Notification } from "../types";
import { NOTIFICATIONS } from "../mock/data";
import { DATA_MODE } from "@/lib/api/client";
import { ApiNotificationsService } from "@/lib/services/backend";
import { Notifier, latency, loadPersisted, persistDebounced } from "./core";

export interface NotificationsService {
  subscribe(fn: () => void): () => void;
  list(): Notification[];
  listAsync(): Promise<Notification[]>;
  unreadCount(): number;
  markRead(id: string): void;
  markAllRead(): void;
  remove(id: string): void;
  /** Used by the publishing engine to raise actionable events. */
  push(n: Notification): void;
}

class MockNotificationsService implements NotificationsService {
  private notifier = new Notifier();
  private items: Notification[] = loadPersisted<Notification[]>("notifications") ?? NOTIFICATIONS.map((n) => ({ ...n }));

  constructor() {
    this.notifier.subscribe(() => persistDebounced("notifications", () => this.items));
  }

  subscribe(fn: () => void) {
    return this.notifier.subscribe(fn);
  }

  list(): Notification[] {
    return [...this.items].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  async listAsync(): Promise<Notification[]> {
    await latency("normal");
    return this.list();
  }

  unreadCount(): number {
    return this.items.filter((n) => !n.read).length;
  }

  markRead(id: string): void {
    this.items = this.items.map((n) => (n.id === id ? { ...n, read: true } : n));
    this.notifier.emit();
  }

  markAllRead(): void {
    this.items = this.items.map((n) => ({ ...n, read: true }));
    this.notifier.emit();
  }

  remove(id: string): void {
    this.items = this.items.filter((n) => n.id !== id);
    this.notifier.emit();
  }

  push(n: Notification): void {
    this.items = [n, ...this.items];
    this.notifier.emit();
  }
}

export const notificationsService: NotificationsService =
  DATA_MODE === "api" ? new ApiNotificationsService() : new MockNotificationsService();
