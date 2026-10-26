import * as Sentry from "@sentry/node";
import { sanitizeTelemetryEvent } from "@aria/shared-types";

// Explicit error capture only: no automatic request/body or SQL instrumentation.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    defaultIntegrations: false,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: sanitizeTelemetryEvent,
    initialScope: { tags: { service: "aria-api" } },
  });
}

export function captureError(error: unknown, tags: Record<string, string> = {}): void {
  if (process.env.SENTRY_DSN) Sentry.captureException(error, { tags });
}

export const flushTelemetry = () => Sentry.close(2_000);
