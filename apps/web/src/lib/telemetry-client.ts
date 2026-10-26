let client: Promise<typeof import("@sentry/browser")> | undefined;

export function initClientTelemetry() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return undefined;
  return client ??= Promise.all([import("@sentry/browser"), import("@aria/shared-types")]).then(([sentry, shared]) => {
    sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      defaultIntegrations: false,
      integrations: [sentry.globalHandlersIntegration()],
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      beforeSend: shared.sanitizeTelemetryEvent,
      initialScope: { tags: { service: "aria-web-browser" } },
    });
    return sentry;
  });
}

export function reportClientError(error: unknown) {
  void initClientTelemetry()?.then((sentry) => sentry.captureException(error)).catch(() => {});
}
