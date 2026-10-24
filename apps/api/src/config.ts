import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4100),
  HOST: z.string().default("127.0.0.1"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
  ARIA_DATA_DIR: z.string().optional(),
  /** Required before any OAuth credentials can be stored (Phase 2). */
  ARIA_ENCRYPTION_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export const config = envSchema.parse(process.env);
export const isProd = config.NODE_ENV === "production";

export const SESSION_COOKIE = "aria_session";
export const SESSION_TTL_DAYS = 30;
