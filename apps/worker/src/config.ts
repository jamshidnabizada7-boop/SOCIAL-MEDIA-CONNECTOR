import { z } from "zod";

export const workerConfig = z
  .object({
    ARIA_DATA_DIR: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    ARIA_ENCRYPTION_KEY: z.string().optional(),
    /** Jobs this process runs at once. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    /** Local-only liveness endpoint used by the container healthcheck. */
    WORKER_HEALTH_PORT: z.coerce.number().int().default(4101),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .parse(process.env);

export type WorkerConfig = z.infer<typeof workerConfig>;
