import { spawn } from "node:child_process";
import path from "node:path";
import { cpSync } from "node:fs";

const env = {
  ...process.env, NEXT_PUBLIC_DATA_MODE: "api", NEXT_PUBLIC_API_URL: "http://127.0.0.1:4180",
  NEXT_PUBLIC_SENTRY_DSN: "", SENTRY_DSN: "", NEXT_TELEMETRY_DISABLED: "1",
};
const cli = path.resolve("node_modules/next/dist/bin/next");
let child;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { child?.kill(signal); process.exit(0); });
child = spawn(process.execPath, [cli, "build"], { cwd: "apps/web", env, stdio: "inherit", windowsHide: true });
const code = await new Promise((resolve) => child.once("exit", resolve));
if (code !== 0) process.exit(code ?? 1);
const standalone = path.resolve("apps/web/.next/standalone/apps/web");
cpSync("apps/web/public", path.join(standalone, "public"), { recursive: true });
cpSync("apps/web/.next/static", path.join(standalone, ".next/static"), { recursive: true });
child = spawn(process.execPath, [path.join(standalone, "server.js")], { env: { ...env, HOSTNAME: "127.0.0.1", PORT: "3180" }, stdio: "inherit", windowsHide: true });
child.once("exit", (status) => process.exit(status ?? 1));
