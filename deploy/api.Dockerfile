# Aria Hub API + Worker image.
# Runs TypeScript directly via tsx because workspace packages resolve to src
# (providers-core package.json points at src/index.ts).
FROM node:22-bookworm-slim

WORKDIR /app

# Workspace manifest files first so npm ci layer-caches.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/providers-core/package.json packages/providers-core/
COPY packages/media-core/package.json packages/media-core/
RUN npm ci

COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages

ENV NODE_ENV=production
EXPOSE 4100

CMD ["npx", "tsx", "apps/api/src/server.ts"]
