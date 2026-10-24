import { z } from "zod";

export const workerConfig = z
  .object({
    REDIS_URL: z.string().optional(),
    ARIA_DATA_DIR: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    ARIA_ENCRYPTION_KEY: z.string().optional(),
    WORKER_CONCURRENCY: z.coerce.number().default(4),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .parse(process.env);

export type WorkerConfig = z.infer<typeof workerConfig>;
