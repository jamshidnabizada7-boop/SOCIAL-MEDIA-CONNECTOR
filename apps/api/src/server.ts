import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { config, isProd } from "./config.js";
import { openAppDatabase } from "./plugins/db.js";
import { sessionHook } from "./plugins/auth.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerWorkspaceRoutes } from "./modules/workspaces/routes.js";
import { registerOauthRoutes } from "./modules/oauth/routes.js";
import { registerAccountRoutes } from "./modules/accounts/routes.js";
import { registerPostRoutes } from "./modules/posts/routes.js";
import { registerNotificationRoutes } from "./modules/notifications/routes.js";
import { registerMediaRoutes } from "./modules/media/routes.js";
import { registerWebhookRoutes } from "./modules/webhooks/routes.js";
import { registerAdminRoutes } from "./modules/admin/routes.js";
import { registerAdminDataRoutes } from "./modules/admin/data-routes.js";
import { registerQueueRoutes } from "./modules/queue/routes.js";
import { registerAnalyticsRoutes } from "./modules/analytics/routes.js";
import { registerBillingRoutes } from "./modules/billing/routes.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.password",
          "req.body.token",
        ],
        censor: "[redacted]",
      },
    },
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });
  const allowedOrigins = config.WEB_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });
  await openAppDatabase(app);

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: { code: error.code ?? "request_error", message: error.message },
      });
    }
    req.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({
      error: { code: "internal_error", message: isProd ? "Something went wrong." : error.message },
    });
  });

  app.get("/health", async () => {
    // Deep ping so load balancers/orchestrators detect DB loss, not just process liveness.
    let db: "ok" | "error" = "error";
    try {
      await app.database.db.execute("select 1");
      db = "ok";
    } catch {
      /* reported below */
    }
    return {
      status: "ok",
      service: "aria-api",
      driver: app.database.driver,
      db,
      version: process.env.npm_package_version ?? "0.1.0",
      time: new Date().toISOString(),
    };
  });

  // Session resolution for every request under /v1.
  app.addHook("preHandler", (req) => sessionHook(app, req));

  registerAuthRoutes(app);
  registerWorkspaceRoutes(app);
  registerOauthRoutes(app);
  registerAccountRoutes(app);
  registerPostRoutes(app);
  registerNotificationRoutes(app);
  registerMediaRoutes(app);
  registerWebhookRoutes(app);
  registerAdminRoutes(app);
  registerAdminDataRoutes(app);
  registerQueueRoutes(app);
  registerAnalyticsRoutes(app);
  registerBillingRoutes(app);

  return app;
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isDirectRun || process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const app = await buildServer();
  app
    .listen({ port: config.PORT, host: config.HOST })
    .then(() => {
      app.log.info(`aria-api listening on http://${config.HOST}:${config.PORT}`);
    })
    .catch((err) => {
      app.log.error(err, "failed to start");
      process.exit(1);
    });
}
