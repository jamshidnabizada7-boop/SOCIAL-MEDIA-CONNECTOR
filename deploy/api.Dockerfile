# Aria Hub API + worker image (one image, two commands).
# TypeScript runs through tsx because providers-core and media-core export
# their sources; @aria/db and @aria/shared-types are compiled in the build stage.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/providers-core/package.json packages/providers-core/
COPY packages/media-core/package.json packages/media-core/

FROM deps AS build
RUN npm ci --no-audit --no-fund
COPY packages packages
RUN npm run build -w @aria/shared-types -w @aria/db

FROM deps AS runtime
ENV NODE_ENV=production
# Production dependencies only (tsx is a runtime dependency of api/worker/db).
RUN npm ci --omit=dev --workspace=@aria/api --workspace=@aria/worker --workspace=@aria/db --include-workspace-root=false --no-audit --no-fund && npm cache clean --force
COPY packages packages
COPY --from=build /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
