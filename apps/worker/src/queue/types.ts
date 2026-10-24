export interface EnqueueOptions {
  delayMs?: number;
  jobId?: string;
  attempts?: number;
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

/**
 * Durable queue abstraction. Two drivers implement it:
 *  - memory: in-process timers, zero dependencies — used for local development.
 *  - bullmq: Redis-backed, used in production (REDIS_URL).
 * The publishing engine never knows which one is active.
 */
export interface QueueDriver {
  readonly name: "memory" | "bullmq";
  enqueue(queue: string, payload: Record<string, unknown>, options?: EnqueueOptions): Promise<void>;
  process(queue: string, handler: JobHandler): Promise<void>;
  close(): Promise<void>;
}
