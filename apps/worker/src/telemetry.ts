import * as Sentry from "@sentry/node";
import { sanitizeTelemetryEvent } from "@aria/shared-types";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    defaultIntegrations: false,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: sanitizeTelemetryEvent,
    initialScope: { tags: { service: "aria-worker" } },
  });
}

export function captureError(error: unknown, tags: Record<string, string> = {}): void {
  if (process.env.SENTRY_DSN) Sentry.captureException(error, { tags });
}

export function captureAlert(code: string, tags: Record<string, string>, metrics: Record<string, number>): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureMessage(code, { level: "error", fingerprint: [code, tags.provider ?? "all"], tags, contexts: { metrics } });
}

export const flushTelemetry = () => Sentry.close(2_000);
