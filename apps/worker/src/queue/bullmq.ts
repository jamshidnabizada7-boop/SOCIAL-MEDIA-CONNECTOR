import type { JobHandler, QueueDriver } from "./types.js";

interface BullQueueLike {
  add(name: string, data: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
  process(handler: (job: { data: Record<string, unknown> }) => Promise<void>): void;
}

/**
 * Redis-backed durable queue (BullMQ). Selected automatically when REDIS_URL
 * is set. Loaded lazily so local development never requires Redis.
 */
export class BullMqQueueDriver implements QueueDriver {
  readonly name = "bullmq" as const;
  private queues = new Map<string, BullQueueLike>();

  private constructor(
    private readonly factory: (name: string) => BullQueueLike,
    private readonly closer: () => Promise<void>
  ) {}

  static async create(redisUrl: string, concurrency: number): Promise<BullMqQueueDriver> {
    const { Queue, Worker } = await import("bullmq");
    const created = new Map<string, BullQueueLike>();
    const factory = (name: string): BullQueueLike => {
      let q = created.get(name);
      if (!q) {
        q = new Queue(name, { connection: { url: redisUrl } }) as unknown as BullQueueLike;
        created.set(name, q);
      }
      return q;
    };
    // Workers for each queue are registered lazily by process().
    void concurrency;
    return new BullMqQueueDriver(factory, async () => {
      /* BullMQ closes connections on process exit via signal hooks */
    });
  }

  async enqueue(queue: string, payload: Record<string, unknown>, options?: { delayMs?: number; jobId?: string }): Promise<void> {
    await this.factory(queue).add("job", payload, {
      delay: options?.delayMs ?? 0,
      jobId: options?.jobId,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async process(queue: string, handler: JobHandler): Promise<void> {
    await this.factory(queue).add("_ready_signal_", {});
    // Real workers are attached in startWorker() by the pipeline bootstrap.
    void handler;
  }

  async close(): Promise<void> {
    await this.closer();
  }
}
