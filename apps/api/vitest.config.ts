import { defineConfig } from "vitest/config";
// Each integration suite boots embedded PostgreSQL. Bound parallelism to avoid setup timeouts.
export default defineConfig({ test: { maxWorkers: 2 } });
