import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Stripe client (REST + form encoding) — no SDK dependency.
 *
 * Configure:
 *   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET    whsec_… (Dashboard → Developers → Webhooks)
 *   STRIPE_PRICE_CREATOR / STRIPE_PRICE_PRO / STRIPE_PRICE_AGENCY   price_… (monthly)
 * Without STRIPE_SECRET_KEY self-serve upgrades are disabled.
 */

const API = "https://api.stripe.com/v1";

export const PAID_PLANS = ["creator", "pro", "agency"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function priceForPlan(planId: string): string | undefined {
  return process.env[`STRIPE_PRICE_${planId.toUpperCase()}`] || undefined;
}

export function planForPrice(priceId: string | undefined | null): PaidPlan | undefined {
  if (!priceId) return undefined;
  return PAID_PLANS.find((p) => priceForPlan(p) === priceId);
}

type Params = Record<string, unknown>;

/** Stripe's bracket notation: { a: { b: 1 }, c: [x] } → a[b]=1&c[0]=x */
function encode(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") encode(v as Params, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(v));
      });
    } else if (typeof value === "object") {
      encode(value as Params, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "StripeError";
  }
}

export async function stripeRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Params = {},
  opts: { idempotencyKey?: string } = {}
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError("Stripe is not configured", 503, "stripe_not_configured");
  const body = encode(params);
  const url = method === "GET" && body.toString() ? `${API}${path}?${body}` : `${API}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: method !== "GET" ? body.toString() : undefined,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
    if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe responded ${res.status}`, res.status, json.error?.code);
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies a Stripe-Signature header (t=…,v1=…) over the raw body, rejecting
 * events older than `toleranceSec` to stop replays.
 */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  const candidates = header
    .split(",")
    .filter((kv) => kv.trim().startsWith("v1="))
    .map((kv) => Buffer.from(kv.trim().slice(3)));
  return candidates.some((c) => c.length === expected.length && timingSafeEqual(c, expected));
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: Array<{ id: string; price: { id: string }; current_period_end?: number }> };
}

/** current_period_end moved onto items in newer API versions — read either. */
export function periodEnd(sub: StripeSubscription): Date | null {
  const seconds = sub.current_period_end ?? sub.items.data[0]?.current_period_end;
  return seconds ? new Date(seconds * 1000) : null;
}
