# Aria Hub web (Next.js standalone). NEXT_PUBLIC_* values are baked in at
# build time — compose passes them as build args.
FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG NEXT_PUBLIC_DATA_MODE=api
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_LEGAL_ENTITY=""
ARG NEXT_PUBLIC_CONTACT_EMAIL=""
ARG NEXT_PUBLIC_LEGAL_UPDATED=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_DATA_MODE=$NEXT_PUBLIC_DATA_MODE \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_LEGAL_ENTITY=$NEXT_PUBLIC_LEGAL_ENTITY \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL \
    NEXT_PUBLIC_LEGAL_UPDATED=$NEXT_PUBLIC_LEGAL_UPDATED \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/providers-core/package.json packages/providers-core/
COPY packages/media-core/package.json packages/media-core/
# The lockfile lists native binaries for every platform, so this is reproducible on arm64 and x64.
RUN npm ci --no-audit --no-fund

COPY apps/web apps/web
COPY packages/shared-types packages/shared-types
RUN npm run build -w @aria/shared-types
RUN npm run build -w @aria/web

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
