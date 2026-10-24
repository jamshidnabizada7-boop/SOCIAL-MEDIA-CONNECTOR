# Aria Hub web (Next.js) image. NEXT_PUBLIC_* values are baked at build time —
# pass them as build args (compose does this from APP_BASE_URL).
FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG NEXT_PUBLIC_DATA_MODE=api
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DATA_MODE=$NEXT_PUBLIC_DATA_MODE \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/providers-core/package.json packages/providers-core/
COPY packages/media-core/package.json packages/media-core/
# npm install (not ci) WITHOUT the lockfile: the lockfile is generated on a
# Windows host and npm cannot add linux-arm64 optional natives (lightningcss)
# from it. --legacy-peer-deps skips the pglite peer conflict the lockfile had
# resolved. Resolving fresh in-container gets the right platform binaries.
RUN rm -f package-lock.json && npm install --no-audit --no-fund --no-save --legacy-peer-deps

COPY apps/web apps/web
RUN npm run build -w @aria/web

FROM node:22-bookworm-slim
WORKDIR /app/apps/web

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/web/.next /app/apps/web/.next
COPY --from=build /app/apps/web/public /app/apps/web/public
COPY --from=build /app/apps/web/package.json /app/apps/web/package.json
COPY --from=build /app/apps/web/next.config.ts /app/apps/web/next.config.ts

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000

CMD ["npx", "next", "start"]
