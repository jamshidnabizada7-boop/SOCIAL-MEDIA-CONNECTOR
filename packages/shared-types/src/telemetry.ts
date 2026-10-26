/** Error reports must never carry session cookies, OAuth tokens, or form bodies. */
export function redactTelemetryText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
      try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch { return "[url]"; }
    })
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/((?:access_token|refresh_token|password|client_secret|aria_session|sig|token)["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, "$1[redacted]");
}

type ErrorEvent = {
  request?: unknown;
  user?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string; stacktrace?: { frames?: Array<{ vars?: unknown }> } }> };
};

/** Shared by the browser, API and worker; no SDK or Node dependencies. */
export function sanitizeTelemetryEvent<T extends ErrorEvent>(event: T): T {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  if (event.message) event.message = redactTelemetryText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactTelemetryText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  return event;
}
