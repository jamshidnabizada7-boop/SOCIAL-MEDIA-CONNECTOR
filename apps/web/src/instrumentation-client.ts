import { initClientTelemetry } from "./lib/telemetry-client";

void initClientTelemetry()?.catch(() => {});
