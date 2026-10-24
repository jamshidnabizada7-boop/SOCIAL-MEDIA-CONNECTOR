import type { EnqueueOptions, JobHandler, QueueDriver } from "./types.js";

/**
 * In-process queue. Good enough for local development and CI — it delivers
 * exactly-once within a single process lifetime, but jobs are not durable
 * across restarts. Production uses the BullMQ driver with Redis.
 */
export class MemoryQueueDriver implements QueueDriver {
  readonly name = "memory" as const;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private handlers = new Map<string, JobHandler>();

  async enqueue(queue: string, payload: Record<string, unknown>, options?: EnqueueOptions): Promise<void> {
    const handler = this.handlers.get(queue);
    if (!handler) throw new Error(`No processor registered for queue "${queue}"`);
    const delay = Math.max(0, options?.delayMs ?? 0);
    const key = options?.jobId ?? `${queue}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void handler(payload).catch((err) => {
        console.error(`[memory-queue] job ${key} failed:`, err.message);
      });
    }, delay);
    this.timers.set(key, timer);
  }

  async process(queue: string, handler: JobHandler): Promise<void> {
    this.handlers.set(queue, handler);
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.handlers.clear();
  }
}
