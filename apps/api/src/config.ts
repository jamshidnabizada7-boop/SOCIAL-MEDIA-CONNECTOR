import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().default(4100),
    HOST: z.string().default("127.0.0.1"),
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    DATABASE_URL: z.string().optional(),
    ARIA_DATA_DIR: z.string().optional(),
    /** 32-byte key (64 hex chars or base64). Required in production; dev auto-generates one under .local/. */
    ARIA_ENCRYPTION_KEY: z.string().optional(),
    /**
     * Which proxy hops to trust for client IPs (rate limiting, audit logs).
     * A hop count ("1", "2") or a comma-separated list of proxy IPs/CIDRs.
     * Caddy normalizes Cloudflare's client IP into one hop: "1" in our stack.
     * Unset trusts nothing; review this when changing the ingress topology.
     */
    TRUST_PROXY: z.string().optional(),
    /** Cookie Domain attribute, e.g. ".example.com" when web and API share a parent domain. */
    SESSION_COOKIE_DOMAIN: z.string().optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.ARIA_ENCRYPTION_KEY) {
      ctx.addIssue({ code: "custom", path: ["ARIA_ENCRYPTION_KEY"], message: "ARIA_ENCRYPTION_KEY is required in production (openssl rand -hex 32)." });
    }
  });

export const config = envSchema.parse(process.env);
export const isProd = config.NODE_ENV === "production";

/** Fastify `trustProxy` value derived from TRUST_PROXY (a hop count, or a comma-separated IP/CIDR list). */
export function trustProxySetting(): boolean | number | string {
  const raw = config.TRUST_PROXY?.trim();
  if (!raw) return false;
  if (raw === "true") return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export const SESSION_COOKIE = "aria_session";
export const SESSION_TTL_DAYS = 30;
