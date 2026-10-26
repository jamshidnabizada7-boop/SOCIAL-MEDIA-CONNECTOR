import * as Sentry from "@sentry/node";
import { sanitizeTelemetryEvent } from "@aria/shared-types";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    defaultIntegrations: false,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: sanitizeTelemetryEvent,
    initialScope: { tags: { service: "aria-web-server" } },
  });
}

export async function reportServerError(error: unknown) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(error);
  await Sentry.flush(2_000);
}
